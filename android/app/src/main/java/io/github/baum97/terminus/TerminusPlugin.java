package io.github.baum97.terminus;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.net.Uri;
import android.os.Build;
import android.provider.CalendarContract.Calendars;
import android.provider.CalendarContract.Events;
import android.provider.CalendarContract.Instances;
import android.provider.CalendarContract.Reminders;
import android.provider.CalendarContract;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.fragment.app.FragmentActivity;
import android.provider.ContactsContract;
import android.provider.ContactsContract.CommonDataKinds.Email;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Set;
import android.content.ClipData;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.Calendar;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Native Teile von Terminus:
 * - Bilder und Text aus dem Android-Teilen-Menü annehmen
 * - Termine direkt in einen Kalender auf dem Gerät eintragen
 * - Text über das Android-Teilen-Menü weitergeben
 */
@CapacitorPlugin(
    name = "Terminus",
    permissions = {
        @Permission(alias = "calendar", strings = { Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR }),
        @Permission(alias = "contacts", strings = { Manifest.permission.READ_CONTACTS }),
        @Permission(alias = "contactsWrite", strings = { Manifest.permission.READ_CONTACTS, Manifest.permission.WRITE_CONTACTS }),
        @Permission(alias = "notifications", strings = { "android.permission.POST_NOTIFICATIONS" })
    }
)
public class TerminusPlugin extends Plugin {

    private static final String BERLIN = "Europe/Berlin";
    private static final int MAX_SIDE = 2000;

    static final String ACTION_CAMERA = "io.github.baum97.terminus.CAMERA";
    static final String ACTION_PICK = "io.github.baum97.terminus.PICK";
    static final String ACTION_CALENDAR = "io.github.baum97.terminus.CALENDAR";

    private Uri pendingImage;
    private String pendingText;
    private String pendingAction;
    private Uri photoUri;

    /* ---------- Teilen-Menü: Eingang ---------- */

    @Override
    public void load() {
        takeIntent(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (takeIntent(intent)) notifyListeners("shared", new JSObject());
    }

    private boolean takeIntent(Intent intent) {
        if (intent == null) return false;
        // Schnellstart vom App-Icon (lange drücken): "Zettel knipsen" oder "Screenshot wählen"
        String a = intent.getAction();
        if (ACTION_CAMERA.equals(a) || ACTION_PICK.equals(a) || ACTION_CALENDAR.equals(a)) {
            pendingAction = ACTION_CAMERA.equals(a) ? "camera" : ACTION_PICK.equals(a) ? "pick" : "calendar";
            intent.setAction(null);
            return true;
        }
        // Beitritt zur Familie: terminus://join?…
        if (Intent.ACTION_VIEW.equals(a) && intent.getData() != null && "terminus".equals(intent.getData().getScheme())) {
            pendingAction = "join";
            pendingText = intent.getData().toString();
            intent.setAction(null);
            return true;
        }
        if (!Intent.ACTION_SEND.equals(intent.getAction())) return false;
        String type = intent.getType();
        if (type != null && type.startsWith("image/")) {
            pendingImage = streamExtra(intent);
            pendingText = null;
        } else {
            String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
            String text = intent.getStringExtra(Intent.EXTRA_TEXT);
            pendingText = subject != null && text != null ? subject + "\n" + text : text != null ? text : subject;
            pendingImage = null;
        }
        // Nicht erneut verarbeiten, wenn die Activity neu aufgebaut wird.
        intent.setAction(null);
        return pendingImage != null || pendingText != null;
    }

    @SuppressWarnings("deprecation")
    private Uri streamExtra(Intent intent) {
        if (Build.VERSION.SDK_INT >= 33) return intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
        return intent.getParcelableExtra(Intent.EXTRA_STREAM);
    }

    @PluginMethod
    public void takeShared(PluginCall call) {
        JSObject result = new JSObject();
        try {
            if (pendingImage != null) result.put("image", imageDataUrl(pendingImage));
            else if ("join".equals(pendingAction)) {
                result.put("action", "join");
                result.put("link", pendingText);
            } else if (pendingText != null) result.put("text", pendingText);
            else if (pendingAction != null) result.put("action", pendingAction);
        } catch (Exception e) {
            pendingImage = null;
            call.reject("Das geteilte Bild konnte nicht gelesen werden.", e);
            return;
        }
        pendingImage = null;
        pendingText = null;
        pendingAction = null;
        call.resolve(result);
    }

    // Bild verkleinert und richtig gedreht als JPEG-Data-URL, wie die Web-App es auch erzeugt.
    private String imageDataUrl(Uri uri) throws Exception {
        ContentResolver resolver = getContext().getContentResolver();
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        try (InputStream in = resolver.openInputStream(uri)) {
            BitmapFactory.decodeStream(in, null, bounds);
        }
        int sample = 1;
        while (Math.max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= MAX_SIDE) sample *= 2;
        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inSampleSize = sample;
        Bitmap bmp;
        try (InputStream in = resolver.openInputStream(uri)) {
            bmp = BitmapFactory.decodeStream(in, null, opts);
        }
        if (bmp == null) throw new IllegalArgumentException("Kein Bild");

        int rotation = 0;
        try (InputStream in = resolver.openInputStream(uri)) {
            int o = new ExifInterface(in).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
            if (o == ExifInterface.ORIENTATION_ROTATE_90) rotation = 90;
            else if (o == ExifInterface.ORIENTATION_ROTATE_180) rotation = 180;
            else if (o == ExifInterface.ORIENTATION_ROTATE_270) rotation = 270;
        } catch (Exception ignored) {}

        float scale = Math.min(1f, (float) MAX_SIDE / Math.max(bmp.getWidth(), bmp.getHeight()));
        if (scale < 1f || rotation != 0) {
            Matrix m = new Matrix();
            m.postScale(scale, scale);
            m.postRotate(rotation);
            bmp = Bitmap.createBitmap(bmp, 0, 0, bmp.getWidth(), bmp.getHeight(), m, true);
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        bmp.compress(Bitmap.CompressFormat.JPEG, 85, out);
        return "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
    }

    /* ---------- Teilen-Menü: Ausgang ---------- */

    @PluginMethod
    public void shareText(PluginCall call) {
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        send.putExtra(Intent.EXTRA_TEXT, call.getString("text", ""));
        String pkg = call.getString("package");
        try {
            if (pkg != null) {
                send.setPackage(pkg);
                getActivity().startActivity(send);
            } else {
                getActivity().startActivity(Intent.createChooser(send, call.getString("title", "Termin teilen")));
            }
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("Keine passende App gefunden.", "not_found");
        }
    }

    /* ---------- Kontakte ---------- */

    // Alle E-Mail-Adressen aus dem Adressbuch des Geräts. Dort landen die Kontakte aller Konten,
    // die mit dem Handy synchronisiert werden (Google, Samsung, GMX/Web.de/Posteo über CardDAV …).
    @PluginMethod
    public void listContacts(PluginCall call) {
        if (getPermissionState("contacts") != PermissionState.GRANTED) {
            requestPermissionForAlias("contacts", call, "listContactsAfterPermission");
            return;
        }
        call.resolve(contacts());
    }

    @PermissionCallback
    private void listContactsAfterPermission(PluginCall call) {
        if (getPermissionState("contacts") == PermissionState.GRANTED) call.resolve(contacts());
        else call.reject("Ohne Zugriff auf die Kontakte kannst du Adressen nur von Hand eingeben.", "denied");
    }

    private JSObject contacts() {
        JSArray list = new JSArray();
        Set<String> seen = new HashSet<>();
        String[] projection = { Email.DISPLAY_NAME_PRIMARY, Email.ADDRESS };
        try (Cursor c = getContext().getContentResolver().query(Email.CONTENT_URI, projection, null, null, Email.DISPLAY_NAME_PRIMARY + " COLLATE LOCALIZED ASC")) {
            while (c != null && c.moveToNext() && list.length() < 5000) {
                String email = c.getString(1);
                if (email == null) continue;
                email = email.trim().toLowerCase();
                if (!email.contains("@") || !seen.add(email)) continue;
                JSObject person = new JSObject();
                String name = c.getString(0);
                person.put("name", name != null ? name : email);
                person.put("email", email);
                list.put(person);
            }
        }
        JSObject result = new JSObject();
        result.put("contacts", list);
        return result;
    }

    /* ---------- Einladung per E-Mail ---------- */

    // Öffnet das eigene Mailprogramm (GMX, Thunderbird, Gmail …) mit Empfängern, Text und Kalenderdatei.
    @PluginMethod
    public void sendEmail(PluginCall call) {
        try {
            JSArray toArr = call.getArray("to", new JSArray());
            ArrayList<String> to = new ArrayList<>();
            for (int i = 0; i < toArr.length(); i++) to.add(toArr.getString(i));

            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("text/plain");
            send.putExtra(Intent.EXTRA_EMAIL, to.toArray(new String[0]));
            send.putExtra(Intent.EXTRA_SUBJECT, call.getString("subject", ""));
            send.putExtra(Intent.EXTRA_TEXT, call.getString("body", ""));

            String ics = call.getString("ics");
            if (ics != null) {
                File dir = new File(getContext().getCacheDir(), "einladungen");
                dir.mkdirs();
                File file = new File(dir, call.getString("fileName", "einladung.ics"));
                try (FileOutputStream out = new FileOutputStream(file)) {
                    out.write(ics.getBytes(StandardCharsets.UTF_8));
                }
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
                send.putExtra(Intent.EXTRA_STREAM, uri);
                send.setClipData(ClipData.newRawUri("", uri));
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            }
            // Nur Mail-Apps anbieten.
            send.setSelector(new Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:")));
            Intent chooser = Intent.createChooser(send, "Einladung senden mit");
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(chooser);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("Auf dem Gerät ist keine Mail-App eingerichtet.", "not_found");
        } catch (Exception e) {
            call.reject("Die Einladung konnte nicht vorbereitet werden.", e);
        }
    }

    /* ---------- Kalender ---------- */

    @PluginMethod
    public void listCalendars(PluginCall call) {
        if (getPermissionState("calendar") != PermissionState.GRANTED) {
            requestPermissionForAlias("calendar", call, "listCalendarsAfterPermission");
            return;
        }
        call.resolve(calendars());
    }

    @PermissionCallback
    private void listCalendarsAfterPermission(PluginCall call) {
        if (getPermissionState("calendar") == PermissionState.GRANTED) call.resolve(calendars());
        else call.reject("Ohne Kalenderzugriff kann Terminus keine Termine eintragen.", "denied");
    }

    private JSObject calendars() {
        JSArray list = new JSArray();
        String[] projection = {
            Calendars._ID, Calendars.CALENDAR_DISPLAY_NAME, Calendars.ACCOUNT_NAME, Calendars.IS_PRIMARY, Calendars.CALENDAR_COLOR, Calendars.ACCOUNT_TYPE,
            Calendars.NAME
        };
        String where = Calendars.CALENDAR_ACCESS_LEVEL + ">=? AND " + Calendars.VISIBLE + "=1";
        String[] args = { String.valueOf(Calendars.CAL_ACCESS_CONTRIBUTOR) };
        try (Cursor c = getContext().getContentResolver().query(Calendars.CONTENT_URI, projection, where, args, null)) {
            while (c != null && c.moveToNext()) {
                JSObject cal = new JSObject();
                cal.put("id", String.valueOf(c.getLong(0)));
                cal.put("name", c.getString(1));
                cal.put("account", c.getString(2));
                cal.put("primary", c.getInt(3) == 1);
                cal.put("color", String.format("#%06X", 0xFFFFFF & c.getInt(4)));
                // z. B. "bitfire.at.davdroid" (DAVx⁵), "com.google", "LOCAL"
                cal.put("accountType", c.getString(5));
                // DAVx⁵ legt hier die Adresse des Kalenders auf dem Server ab (für Einladungen)
                String name = c.getString(6);
                if (name != null && name.startsWith("https://")) cal.put("url", name);
                list.put(cal);
            }
        }
        JSObject result = new JSObject();
        result.put("calendars", list);
        return result;
    }

    @PluginMethod
    public void insertEvents(PluginCall call) {
        if (getPermissionState("calendar") != PermissionState.GRANTED) {
            requestPermissionForAlias("calendar", call, "insertEventsAfterPermission");
            return;
        }
        doInsert(call);
    }

    @PermissionCallback
    private void insertEventsAfterPermission(PluginCall call) {
        if (getPermissionState("calendar") == PermissionState.GRANTED) doInsert(call);
        else call.reject("Ohne Kalenderzugriff kann Terminus keine Termine eintragen.", "denied");
    }

    private void doInsert(PluginCall call) {
        JSArray events = call.getArray("events");
        if (events == null || events.length() == 0) {
            call.reject("Keine Termine übergeben.");
            return;
        }
        long calendarId = pickCalendar(call.getString("calendarId"));
        if (calendarId < 0) {
            call.reject("Auf diesem Gerät gibt es keinen beschreibbaren Kalender. Richte in der Kalender-App ein Konto ein.", "no_calendar");
            return;
        }
        ContentResolver resolver = getContext().getContentResolver();
        int count = 0;
        try {
            for (int i = 0; i < events.length(); i++) {
                JSONObject ev = events.getJSONObject(i);
                long[] span = span(ev);
                boolean allDay = ev.isNull("start");
                ContentValues v = new ContentValues();
                v.put(Events.CALENDAR_ID, calendarId);
                v.put(Events.TITLE, ev.optString("summary", ev.optString("title", "Termin")));
                v.put(Events.EVENT_LOCATION, ev.optString("location", ""));
                v.put(Events.DESCRIPTION, ev.optString("description", ""));
                v.put(Events.DTSTART, span[0]);
                String rule = ev.optString("rrule", "");
                if (rule.isEmpty()) {
                    v.put(Events.DTEND, span[1]);
                } else {
                    // Serientermine brauchen bei Android eine Dauer statt eines Endes.
                    v.put(Events.RRULE, rule);
                    String exdate = ev.optString("exdate", "");
                    if (!exdate.isEmpty()) v.put(Events.EXDATE, exdate);
                    v.put(Events.DURATION, allDay ? "P" + ((span[1] - span[0]) / 86400000L) + "D" : "PT" + ((span[1] - span[0]) / 60000L) + "M");
                }
                v.put(Events.ALL_DAY, allDay ? 1 : 0);
                v.put(Events.EVENT_TIMEZONE, allDay ? "UTC" : BERLIN);
                Uri uri = resolver.insert(Events.CONTENT_URI, v);
                if (uri == null) continue;
                count++;
                JSONArray reminders = ev.optJSONArray("reminders");
                for (int k = 0; reminders != null && k < reminders.length(); k++) {
                    ContentValues r = new ContentValues();
                    r.put(Reminders.EVENT_ID, Long.parseLong(uri.getLastPathSegment()));
                    r.put(Reminders.MINUTES, reminders.getInt(k));
                    r.put(Reminders.METHOD, Reminders.METHOD_ALERT);
                    resolver.insert(Reminders.CONTENT_URI, r);
                }
            }
        } catch (Exception e) {
            call.reject("Eintragen ist fehlgeschlagen: " + e.getMessage(), e);
            return;
        }
        TerminusWidget.refresh(getContext());
        JSObject result = new JSObject();
        result.put("count", count);
        result.put("calendarId", String.valueOf(calendarId));
        call.resolve(result);
    }

    private long pickCalendar(String wanted) {
        JSONArray list = calendars().optJSONArray("calendars");
        long first = -1, primary = -1;
        for (int i = 0; list != null && i < list.length(); i++) {
            JSONObject cal = list.optJSONObject(i);
            long id = Long.parseLong(cal.optString("id"));
            if (cal.optString("id").equals(wanted)) return id;
            if (first < 0) first = id;
            if (primary < 0 && cal.optBoolean("primary")) primary = id;
        }
        return primary >= 0 ? primary : first;
    }

    // [Beginn, Ende] in Millisekunden. Ganztägige Termine in UTC, Ende exklusiv am Folgetag.
    private static long[] span(JSONObject ev) throws Exception {
        String date = ev.getString("date");
        String endDate = ev.isNull("endDate") ? date : ev.getString("endDate");
        if (ev.isNull("start")) {
            Calendar s = day(date, "UTC");
            Calendar e = day(endDate, "UTC");
            e.add(Calendar.DAY_OF_MONTH, 1);
            return new long[] { s.getTimeInMillis(), e.getTimeInMillis() };
        }
        Calendar s = at(date, ev.getString("start"));
        Calendar e;
        if (!ev.isNull("end")) {
            e = at(endDate, ev.getString("end"));
        } else {
            e = (Calendar) s.clone();
            e.add(Calendar.MINUTE, ev.optInt("defaultMinutes", 60));
        }
        return new long[] { s.getTimeInMillis(), e.getTimeInMillis() };
    }

    private static Calendar day(String iso, String tz) {
        String[] p = iso.split("-");
        Calendar c = Calendar.getInstance(TimeZone.getTimeZone(tz));
        c.clear();
        c.set(Integer.parseInt(p[0]), Integer.parseInt(p[1]) - 1, Integer.parseInt(p[2]), 0, 0, 0);
        return c;
    }

    private static Calendar at(String iso, String time) {
        Calendar c = day(iso, BERLIN);
        String[] t = time.split(":");
        c.set(Calendar.HOUR_OF_DAY, Integer.parseInt(t[0]));
        c.set(Calendar.MINUTE, Integer.parseInt(t[1]));
        return c;
    }

    // Einzelner Termin ohne Berechtigung: Kalender-App öffnet sich vorausgefüllt.
    @PluginMethod
    public void openInCalendar(PluginCall call) {
        try {
            JSONObject ev = call.getObject("event");
            long[] span = span(ev);
            Intent i = new Intent(Intent.ACTION_INSERT)
                .setData(Events.CONTENT_URI)
                .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, span[0])
                .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, span[1])
                .putExtra(CalendarContract.EXTRA_EVENT_ALL_DAY, ev.isNull("start"))
                .putExtra(Events.TITLE, ev.optString("summary", ev.optString("title", "Termin")))
                .putExtra(Events.EVENT_LOCATION, ev.optString("location", ""))
                .putExtra(Events.DESCRIPTION, ev.optString("description", ""));
            if (!ev.optString("rrule", "").isEmpty()) i.putExtra(Events.RRULE, ev.getString("rrule"));
            getActivity().startActivity(i);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("Keine Kalender-App gefunden.", "not_found");
        } catch (Exception e) {
            call.reject("Der Termin konnte nicht geöffnet werden.", e);
        }
    }

    /* ---------- Abgleich mit dem Kalender ---------- */

    // Termine im Zeitraum, für Hinweise auf Doppelte und Überschneidungen.
    // Fragt nicht nach der Berechtigung: ohne Zugriff kommt granted=false zurück.
    @PluginMethod
    public void findEvents(PluginCall call) {
        JSObject result = new JSObject();
        JSArray list = new JSArray();
        boolean granted = getPermissionState("calendar") == PermissionState.GRANTED;
        result.put("granted", granted);
        if (granted) {
            long from = call.getLong("from", 0L);
            long to = call.getLong("to", 0L);
            String[] projection = {
                Instances.TITLE, Instances.BEGIN, Instances.END, Instances.ALL_DAY, Instances.EVENT_ID, Instances.CALENDAR_ID,
                Instances.DISPLAY_COLOR, Instances.EVENT_LOCATION, Instances.DESCRIPTION, Instances.CALENDAR_DISPLAY_NAME, Instances.RRULE
            };
            Uri uri = Instances.CONTENT_URI.buildUpon().appendPath(String.valueOf(from)).appendPath(String.valueOf(to)).build();
            try (Cursor c = getContext().getContentResolver().query(uri, projection, Instances.VISIBLE + "=1", null, Instances.BEGIN + " ASC")) {
                while (c != null && c.moveToNext() && list.length() < 2000) {
                    JSObject ev = new JSObject();
                    ev.put("title", c.getString(0));
                    ev.put("begin", c.getLong(1));
                    ev.put("end", c.getLong(2));
                    ev.put("allDay", c.getInt(3) == 1);
                    ev.put("id", String.valueOf(c.getLong(4)));
                    ev.put("calendarId", String.valueOf(c.getLong(5)));
                    ev.put("color", String.format("#%06X", 0xFFFFFF & c.getInt(6)));
                    ev.put("location", c.getString(7));
                    ev.put("description", c.getString(8));
                    ev.put("calendar", c.getString(9));
                    ev.put("recurring", c.getString(10) != null);
                    list.put(ev);
                }
            } catch (Exception ignored) {}
        }
        result.put("events", list);
        call.resolve(result);
    }

    /* ---------- Karten-App ---------- */

    // Öffnet die eingestellte Karten-App (OsmAnd, Organic Maps, Google Maps …) mit der Adresse.
    @PluginMethod
    public void openMap(PluginCall call) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=" + Uri.encode(call.getString("query", ""))));
            getActivity().startActivity(i);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("Keine Karten-App gefunden.", "not_found");
        }
    }

    /* ---------- Kamera und Galerie ---------- */

    @PluginMethod
    public void takePhoto(PluginCall call) {
        try {
            File dir = new File(getContext().getCacheDir(), "fotos");
            dir.mkdirs();
            File file = new File(dir, "zettel.jpg");
            photoUri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent i = new Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE);
            i.putExtra(android.provider.MediaStore.EXTRA_OUTPUT, photoUri);
            i.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivityForResult(call, i, "photoResult");
        } catch (Exception e) {
            call.reject("Die Kamera konnte nicht geöffnet werden.", e);
        }
    }

    @ActivityCallback
    private void photoResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || photoUri == null) {
            call.resolve(new JSObject());
            return;
        }
        resolveImage(call, photoUri);
    }

    @PluginMethod
    public void pickImage(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_GET_CONTENT);
        i.setType("image/*");
        i.addCategory(Intent.CATEGORY_OPENABLE);
        startActivityForResult(call, i, "pickResult");
    }

    @ActivityCallback
    private void pickResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            call.resolve(new JSObject());
            return;
        }
        resolveImage(call, data.getData());
    }

    private void resolveImage(PluginCall call, Uri uri) {
        try {
            JSObject r = new JSObject();
            r.put("image", imageDataUrl(uri));
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Das Bild konnte nicht gelesen werden.", e);
        }
    }

    /* ---------- Datei teilen (z. B. QR-Code als Bild) ---------- */

    @PluginMethod
    public void shareFile(PluginCall call) {
        try {
            byte[] bytes = Base64.decode(call.getString("base64", ""), Base64.DEFAULT);
            File dir = new File(getContext().getCacheDir(), "teilen");
            dir.mkdirs();
            File file = new File(dir, call.getString("fileName", "terminus.png"));
            try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(bytes);
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(call.getString("mimeType", "image/png"));
            send.putExtra(Intent.EXTRA_STREAM, uri);
            String text = call.getString("text");
            if (text != null) send.putExtra(Intent.EXTRA_TEXT, text);
            send.setClipData(ClipData.newRawUri("", uri));
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, call.getString("title", "Teilen"));
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject("Teilen hat nicht geklappt.", e);
        }
    }

    /* ---------- Termine ändern, löschen, öffnen ---------- */

    // Ändert Titel und/oder Beschreibung (Häkchen der Mitbringliste, Zuständigkeit, Frist erledigt).
    // Bei Serien betrifft das die ganze Serie.
    // Ändert einen Termin. Felder: title, description, location und optional die Zeit
    // (date, start, end, endDate wie beim Eintragen). Mit "occurrence" (Beginn in ms) wird bei einer
    // Serie nur dieser eine Termin geändert, sonst die ganze Serie (dann bleibt das Datum, nur die Uhrzeit ändert sich).
    @PluginMethod
    public void updateEvent(PluginCall call) {
        if (getPermissionState("calendar") != PermissionState.GRANTED) {
            call.reject("Kein Zugriff auf den Kalender.", "denied");
            return;
        }
        try {
            long id = Long.parseLong(call.getString("id"));
            ContentResolver resolver = getContext().getContentResolver();
            ContentValues v = new ContentValues();
            if (call.hasOption("title")) v.put(Events.TITLE, call.getString("title"));
            if (call.hasOption("description")) v.put(Events.DESCRIPTION, call.getString("description"));
            if (call.hasOption("location")) v.put(Events.EVENT_LOCATION, call.getString("location"));
            JSObject when = call.getObject("when");
            Long occurrence = call.getLong("occurrence");
            int n;
            if (occurrence != null) {
                // Ausnahme für einen einzelnen Termin der Serie
                v.put(Events.ORIGINAL_INSTANCE_TIME, occurrence);
                if (when != null) putTimes(v, when, 0);
                Uri ex = ContentUris.withAppendedId(Events.CONTENT_EXCEPTION_URI, id);
                n = resolver.insert(ex, v) != null ? 1 : 0;
            } else {
                if (when != null) putTimes(v, when, isRecurring(id) ? id : 0);
                n = resolver.update(ContentUris.withAppendedId(Events.CONTENT_URI, id), v, null, null);
            }
            TerminusWidget.refresh(getContext());
            JSObject r = new JSObject();
            r.put("updated", n);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Der Termin konnte nicht geändert werden.", e);
        }
    }

    private boolean isRecurring(long id) {
        try (Cursor c = getContext().getContentResolver().query(ContentUris.withAppendedId(Events.CONTENT_URI, id), new String[] { Events.RRULE }, null, null, null)) {
            return c != null && c.moveToFirst() && c.getString(0) != null;
        }
    }

    private long seriesStart(long id) {
        try (Cursor c = getContext().getContentResolver().query(ContentUris.withAppendedId(Events.CONTENT_URI, id), new String[] { Events.DTSTART }, null, null, null)) {
            return c != null && c.moveToFirst() ? c.getLong(0) : 0;
        }
    }

    // seriesId > 0: ganze Serie ändern. Das Datum des ersten Termins bleibt, Uhrzeit und Dauer ändern sich.
    private void putTimes(ContentValues v, JSONObject when, long seriesId) throws Exception {
        long[] span = span(when);
        boolean allDay = when.isNull("start");
        v.put(Events.ALL_DAY, allDay ? 1 : 0);
        v.put(Events.EVENT_TIMEZONE, allDay ? "UTC" : BERLIN);
        if (seriesId <= 0) {
            v.put(Events.DTSTART, span[0]);
            v.put(Events.DTEND, span[1]);
            return;
        }
        long first = span[0];
        if (!allDay) {
            Calendar old = Calendar.getInstance(TimeZone.getTimeZone(BERLIN));
            old.setTimeInMillis(seriesStart(seriesId));
            Calendar now = Calendar.getInstance(TimeZone.getTimeZone(BERLIN));
            now.setTimeInMillis(span[0]);
            old.set(Calendar.HOUR_OF_DAY, now.get(Calendar.HOUR_OF_DAY));
            old.set(Calendar.MINUTE, now.get(Calendar.MINUTE));
            first = old.getTimeInMillis();
        }
        v.put(Events.DTSTART, first);
        v.putNull(Events.DTEND);
        v.put(Events.DURATION, allDay ? "P" + ((span[1] - span[0]) / 86400000L) + "D" : "PT" + ((span[1] - span[0]) / 60000L) + "M");
    }

    // Nur diesen einen Termin einer Serie absagen
    @PluginMethod
    public void cancelOccurrence(PluginCall call) {
        if (getPermissionState("calendar") != PermissionState.GRANTED) {
            call.reject("Kein Zugriff auf den Kalender.", "denied");
            return;
        }
        try {
            ContentValues v = new ContentValues();
            v.put(Events.ORIGINAL_INSTANCE_TIME, call.getLong("occurrence"));
            v.put(Events.STATUS, Events.STATUS_CANCELED);
            Uri ex = ContentUris.withAppendedId(Events.CONTENT_EXCEPTION_URI, Long.parseLong(call.getString("id")));
            getContext().getContentResolver().insert(ex, v);
            TerminusWidget.refresh(getContext());
            call.resolve();
        } catch (Exception e) {
            call.reject("Der Termin konnte nicht abgesagt werden.", e);
        }
    }

    @PluginMethod
    public void deleteEvent(PluginCall call) {
        if (getPermissionState("calendar") != PermissionState.GRANTED) {
            call.reject("Kein Zugriff auf den Kalender.", "denied");
            return;
        }
        try {
            Uri uri = ContentUris.withAppendedId(Events.CONTENT_URI, Long.parseLong(call.getString("id")));
            getContext().getContentResolver().delete(uri, null, null);
            TerminusWidget.refresh(getContext());
            call.resolve();
        } catch (Exception e) {
            call.reject("Der Termin konnte nicht gelöscht werden.", e);
        }
    }

    @PluginMethod
    public void openEvent(PluginCall call) {
        try {
            Uri uri = ContentUris.withAppendedId(Events.CONTENT_URI, Long.parseLong(call.getString("id")));
            getActivity().startActivity(new Intent(Intent.ACTION_VIEW).setData(uri));
            call.resolve();
        } catch (Exception e) {
            call.reject("Keine Kalender-App gefunden.", "not_found");
        }
    }

    /* ---------- Geburtstage aus dem Adressbuch ---------- */

    @PluginMethod
    public void listBirthdays(PluginCall call) {
        if (getPermissionState("contacts") != PermissionState.GRANTED) {
            requestPermissionForAlias("contacts", call, "birthdaysAfterPermission");
            return;
        }
        call.resolve(birthdays());
    }

    @PermissionCallback
    private void birthdaysAfterPermission(PluginCall call) {
        if (getPermissionState("contacts") == PermissionState.GRANTED) call.resolve(birthdays());
        else call.reject("Ohne Zugriff auf die Kontakte gibt es keine Geburtstage.", "denied");
    }

    private JSObject birthdays() {
        JSArray list = new JSArray();
        String[] projection = { ContactsContract.Data.DISPLAY_NAME_PRIMARY, ContactsContract.CommonDataKinds.Event.START_DATE };
        String where = ContactsContract.Data.MIMETYPE + "=? AND " + ContactsContract.CommonDataKinds.Event.TYPE + "=?";
        String[] args = { ContactsContract.CommonDataKinds.Event.CONTENT_ITEM_TYPE, String.valueOf(ContactsContract.CommonDataKinds.Event.TYPE_BIRTHDAY) };
        Set<String> seen = new HashSet<>();
        try (Cursor c = getContext().getContentResolver().query(ContactsContract.Data.CONTENT_URI, projection, where, args, null)) {
            while (c != null && c.moveToNext()) {
                String name = c.getString(0), date = c.getString(1);
                if (name == null || date == null || !seen.add(name + date)) continue;
                JSObject b = new JSObject();
                b.put("name", name);
                b.put("date", date);
                list.put(b);
            }
        }
        JSObject r = new JSObject();
        r.put("birthdays", list);
        return r;
    }

    /* ---------- Morgen-Überblick ---------- */

    @PluginMethod
    public void setMorningBrief(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        if (enabled && Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "morningAfterPermission");
            return;
        }
        applyMorning(call);
    }

    @PermissionCallback
    private void morningAfterPermission(PluginCall call) {
        if (getPermissionState("notifications") != PermissionState.GRANTED) {
            call.reject("Ohne Erlaubnis für Benachrichtigungen gibt es keinen Morgen-Überblick.", "denied");
            return;
        }
        applyMorning(call);
    }

    private void applyMorning(PluginCall call) {
        MorningBrief.save(getContext(), Boolean.TRUE.equals(call.getBoolean("enabled", false)), call.getInt("hour", 7), call.getInt("minute", 0));
        MorningBrief.schedule(getContext());
        call.resolve();
    }

    @PluginMethod
    public void showMorningBrief(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "showMorningAfterPermission");
            return;
        }
        JSObject r = new JSObject();
        r.put("shown", MorningBrief.show(getContext(), true));
        call.resolve(r);
    }

    @PermissionCallback
    private void showMorningAfterPermission(PluginCall call) {
        JSObject r = new JSObject();
        r.put("shown", getPermissionState("notifications") == PermissionState.GRANTED && MorningBrief.show(getContext(), true));
        call.resolve(r);
    }

    /* ---------- Kalender abonnieren (über ICSx⁵) ---------- */

    @PluginMethod
    public void openSubscription(PluginCall call) {
        String url = call.getString("url", "").trim().replaceFirst("^https://", "webcals://").replaceFirst("^http://", "webcal://");
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.setPackage("at.bitfire.icsdroid");
            getActivity().startActivity(i);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("ICSx⁵ ist nicht installiert.", "not_found");
        }
    }

    /* ---------- App-Sperre ---------- */

    private static final int LOCK_AUTH = BiometricManager.Authenticators.BIOMETRIC_WEAK | BiometricManager.Authenticators.DEVICE_CREDENTIAL;

    @PluginMethod
    public void lockAvailable(PluginCall call) {
        JSObject r = new JSObject();
        boolean ok = Build.VERSION.SDK_INT >= 30
            ? BiometricManager.from(getContext()).canAuthenticate(LOCK_AUTH) == BiometricManager.BIOMETRIC_SUCCESS
            : ((android.app.KeyguardManager) getContext().getSystemService(android.content.Context.KEYGUARD_SERVICE)).isDeviceSecure();
        r.put("available", ok);
        call.resolve(r);
    }

    @SuppressWarnings("deprecation")
    @PluginMethod
    public void authenticate(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                BiometricPrompt prompt = new BiometricPrompt((FragmentActivity) getActivity(), androidx.core.content.ContextCompat.getMainExecutor(getContext()),
                    new BiometricPrompt.AuthenticationCallback() {
                        @Override
                        public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                            JSObject r = new JSObject();
                            r.put("ok", true);
                            call.resolve(r);
                        }

                        @Override
                        public void onAuthenticationError(int code, CharSequence msg) {
                            call.reject(msg.toString(), "cancel");
                        }
                    });
                BiometricPrompt.PromptInfo.Builder b = new BiometricPrompt.PromptInfo.Builder()
                    .setTitle("Terminus entsperren")
                    .setSubtitle(call.getString("reason", "Familientermine sind privat."));
                if (Build.VERSION.SDK_INT >= 30) b.setAllowedAuthenticators(LOCK_AUTH);
                else b.setDeviceCredentialAllowed(true);
                prompt.authenticate(b.build());
            } catch (Exception e) {
                call.reject("Entsperren ist auf diesem Gerät nicht möglich.", e);
            }
        });
    }

    /* ---------- Einrichtungsassistent ---------- */

    @PluginMethod
    public void isInstalled(PluginCall call) {
        JSObject installed = new JSObject();
        try {
            JSArray pkgs = call.getArray("packages", new JSArray());
            for (int i = 0; i < pkgs.length(); i++) {
                String p = pkgs.getString(i);
                boolean ok;
                try {
                    getContext().getPackageManager().getPackageInfo(p, 0);
                    ok = true;
                } catch (android.content.pm.PackageManager.NameNotFoundException e) {
                    ok = false;
                }
                installed.put(p, ok);
            }
        } catch (Exception ignored) {}
        JSObject r = new JSObject();
        r.put("installed", installed);
        call.resolve(r);
    }

    @PluginMethod
    public void checkLogin(PluginCall call) {
        call.resolve(Setup.checkLogin(call.getString("url", ""), call.getString("user", ""), call.getString("password", "")));
    }

    // Öffnet die Anmeldung von DAVx⁵ mit Server und Name (und Passwort, falls angegeben) vorausgefüllt
    @PluginMethod
    public void openDavx5(PluginCall call) {
        JSObject r = new JSObject();
        try {
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setClassName("at.bitfire.davdroid", "at.bitfire.davdroid.ui.setup.LoginActivity");
            i.putExtra("url", call.getString("url", ""));
            i.putExtra("username", call.getString("username", ""));
            if (call.getString("password") != null) i.putExtra("password", call.getString("password"));
            getActivity().startActivity(i);
            r.put("prefilled", true);
            call.resolve(r);
        } catch (Exception e) {
            Intent launch = getContext().getPackageManager().getLaunchIntentForPackage("at.bitfire.davdroid");
            if (launch == null) {
                call.reject("DAVx⁵ ist nicht installiert.", "not_found");
                return;
            }
            getActivity().startActivity(launch);
            r.put("prefilled", false);
            call.resolve(r);
        }
    }

    private static long[] longs(JSArray arr) throws Exception {
        long[] out = new long[arr.length()];
        for (int i = 0; i < arr.length(); i++) out[i] = Long.parseLong(arr.getString(i));
        return out;
    }

    @PluginMethod
    public void countEvents(PluginCall call) {
        if (getPermissionState("calendar") != PermissionState.GRANTED) {
            call.reject("Kein Zugriff auf den Kalender.", "denied");
            return;
        }
        try {
            call.resolve(Setup.countEvents(getContext(), longs(call.getArray("calendars", new JSArray()))));
        } catch (Exception e) {
            call.reject("Zählen hat nicht geklappt.", e);
        }
    }

    @PluginMethod
    public void copyCalendars(PluginCall call) {
        if (getPermissionState("calendar") != PermissionState.GRANTED) {
            call.reject("Kein Zugriff auf den Kalender.", "denied");
            return;
        }
        try {
            call.resolve(Setup.copyCalendars(getContext(), longs(call.getArray("from", new JSArray())), Long.parseLong(call.getString("to"))));
        } catch (Exception e) {
            call.reject("Der Umzug der Termine hat nicht geklappt: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void addressBooks(PluginCall call) {
        if (getPermissionState("contactsWrite") != PermissionState.GRANTED) {
            requestPermissionForAlias("contactsWrite", call, "addressBooksAfterPermission");
            return;
        }
        call.resolve(Setup.addressBooks(getContext()));
    }

    @PermissionCallback
    private void addressBooksAfterPermission(PluginCall call) {
        if (getPermissionState("contactsWrite") == PermissionState.GRANTED) call.resolve(Setup.addressBooks(getContext()));
        else call.reject("Ohne Zugriff auf die Kontakte geht der Umzug nicht.", "denied");
    }

    @PluginMethod
    public void copyContacts(PluginCall call) {
        if (getPermissionState("contactsWrite") != PermissionState.GRANTED) {
            call.reject("Kein Zugriff auf die Kontakte.", "denied");
            return;
        }
        try {
            call.resolve(Setup.copyContacts(getContext(), call.getString("fromName"), call.getString("fromType"), call.getString("toName"), call.getString("toType")));
        } catch (Exception e) {
            call.reject("Der Umzug der Kontakte hat nicht geklappt: " + e.getMessage(), e);
        }
    }

    // Springt in die passende Android-Einstellung: Konten (Google-Sync), Akku, App-Info
    @PluginMethod
    public void openSettings(PluginCall call) {
        String which = call.getString("which", "app");
        Intent i;
        if ("sync".equals(which)) i = new Intent(android.provider.Settings.ACTION_SYNC_SETTINGS);
        else if ("battery".equals(which)) i = new Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
        else if ("notifications".equals(which) && Build.VERSION.SDK_INT >= 26) {
            i = new Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        } else {
            i = new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + call.getString("package", getContext().getPackageName())));
        }
        try {
            getActivity().startActivity(i);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("Diese Einstellung gibt es auf dem Gerät nicht.", "not_found");
        }
    }

    @PluginMethod
    public void deviceStatus(PluginCall call) {
        JSObject r = new JSObject();
        android.os.PowerManager pm = (android.os.PowerManager) getContext().getSystemService(android.content.Context.POWER_SERVICE);
        JSObject battery = new JSObject();
        try {
            JSArray pkgs = call.getArray("packages", new JSArray());
            for (int i = 0; i < pkgs.length(); i++) battery.put(pkgs.getString(i), pm.isIgnoringBatteryOptimizations(pkgs.getString(i)));
        } catch (Exception ignored) {}
        r.put("batteryFree", battery);
        r.put("notifications", androidx.core.app.NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
        r.put("calendar", getPermissionState("calendar") == PermissionState.GRANTED);
        r.put("contacts", getPermissionState("contacts") == PermissionState.GRANTED);
        android.appwidget.AppWidgetManager wm = android.appwidget.AppWidgetManager.getInstance(getContext());
        r.put("widgets", wm.getAppWidgetIds(new android.content.ComponentName(getContext(), TerminusWidget.class)).length);
        r.put("widgetPinSupported", Build.VERSION.SDK_INT >= 26 && wm.isRequestPinAppWidgetSupported());
        call.resolve(r);
    }

    // Legt das Widget auf den Startbildschirm (Android fragt einmal nach)
    @PluginMethod
    public void pinWidget(PluginCall call) {
        JSObject r = new JSObject();
        if (Build.VERSION.SDK_INT < 26) {
            r.put("requested", false);
            call.resolve(r);
            return;
        }
        android.appwidget.AppWidgetManager wm = android.appwidget.AppWidgetManager.getInstance(getContext());
        r.put("requested", wm.isRequestPinAppWidgetSupported() && wm.requestPinAppWidget(new android.content.ComponentName(getContext(), TerminusWidget.class), null, null));
        call.resolve(r);
    }

    @PluginMethod
    public void exportCalendar(PluginCall call) {
        if (getPermissionState("calendar") != PermissionState.GRANTED) {
            call.reject("Kein Zugriff auf den Kalender.", "denied");
            return;
        }
        try {
            call.resolve(Setup.exportCalendar(getContext(), Long.parseLong(call.getString("id"))));
        } catch (Exception e) {
            call.reject("Der Kalender konnte nicht gelesen werden.", e);
        }
    }
}
