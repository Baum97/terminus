package io.github.baum97.terminus;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
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
import android.provider.CalendarContract.Reminders;
import android.provider.CalendarContract;
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
        @Permission(alias = "contacts", strings = { Manifest.permission.READ_CONTACTS })
    }
)
public class TerminusPlugin extends Plugin {

    private static final String BERLIN = "Europe/Berlin";
    private static final int MAX_SIDE = 2000;

    private Uri pendingImage;
    private String pendingText;

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
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return false;
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
            else if (pendingText != null) result.put("text", pendingText);
        } catch (Exception e) {
            pendingImage = null;
            call.reject("Das geteilte Bild konnte nicht gelesen werden.", e);
            return;
        }
        pendingImage = null;
        pendingText = null;
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
            Calendars._ID, Calendars.CALENDAR_DISPLAY_NAME, Calendars.ACCOUNT_NAME, Calendars.IS_PRIMARY, Calendars.CALENDAR_COLOR
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
                v.put(Events.TITLE, ev.optString("title", "Termin"));
                v.put(Events.EVENT_LOCATION, ev.optString("location", ""));
                v.put(Events.DESCRIPTION, ev.optString("description", ""));
                v.put(Events.DTSTART, span[0]);
                v.put(Events.DTEND, span[1]);
                v.put(Events.ALL_DAY, allDay ? 1 : 0);
                v.put(Events.EVENT_TIMEZONE, allDay ? "UTC" : BERLIN);
                Uri uri = resolver.insert(Events.CONTENT_URI, v);
                if (uri == null) continue;
                count++;
                if (!ev.isNull("alarmMinutes")) {
                    ContentValues r = new ContentValues();
                    r.put(Reminders.EVENT_ID, Long.parseLong(uri.getLastPathSegment()));
                    // Ganztägig: am Vortag um 18 Uhr, wie in der .ics-Datei.
                    r.put(Reminders.MINUTES, allDay ? 6 * 60 : ev.getInt("alarmMinutes"));
                    r.put(Reminders.METHOD, Reminders.METHOD_ALERT);
                    resolver.insert(Reminders.CONTENT_URI, r);
                }
            }
        } catch (Exception e) {
            call.reject("Eintragen ist fehlgeschlagen: " + e.getMessage(), e);
            return;
        }
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
                .putExtra(Events.TITLE, ev.optString("title", "Termin"))
                .putExtra(Events.EVENT_LOCATION, ev.optString("location", ""))
                .putExtra(Events.DESCRIPTION, ev.optString("description", ""));
            getActivity().startActivity(i);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("Keine Kalender-App gefunden.", "not_found");
        } catch (Exception e) {
            call.reject("Der Termin konnte nicht geöffnet werden.", e);
        }
    }
}
