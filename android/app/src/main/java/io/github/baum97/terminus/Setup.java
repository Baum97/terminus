package io.github.baum97.terminus;

import android.accounts.Account;
import android.accounts.AccountManager;
import android.content.ContentProviderOperation;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.CalendarContract.Events;
import android.provider.CalendarContract.Reminders;
import android.provider.ContactsContract;
import android.provider.ContactsContract.CommonDataKinds.GroupMembership;
import android.provider.ContactsContract.Data;
import android.provider.ContactsContract.RawContacts;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/** Werkzeuge für den Einrichtungsassistenten: Umzug direkt auf dem Gerät, Zugang prüfen, Adressbücher finden. */
final class Setup {

    private Setup() {}

    /* ---------- Zugang beim Anbieter prüfen ---------- */

    /** GET mit Anmeldung. 401/403 heißt: Name oder Passwort falsch. Alles andere: Anmeldung angenommen. */
    static JSObject checkLogin(String url, String user, String password) {
        JSObject r = new JSObject();
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(15000);
            c.setReadTimeout(15000);
            String token = Base64.encodeToString((user + ":" + password).getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
            c.setRequestProperty("Authorization", "Basic " + token);
            c.setRequestProperty("User-Agent", "Terminus");
            int status = c.getResponseCode();
            r.put("status", status);
            r.put("ok", status != 401 && status != 403 && status < 500);
        } catch (Exception e) {
            r.put("status", 0);
            r.put("ok", false);
            r.put("error", e.getClass().getSimpleName());
        } finally {
            if (c != null) c.disconnect();
        }
        return r;
    }

    /* ---------- Kalender umziehen ---------- */

    private static final String[] EVENT_COLS = {
        Events._ID, Events.TITLE, Events.DESCRIPTION, Events.EVENT_LOCATION, Events.DTSTART, Events.DTEND, Events.DURATION,
        Events.ALL_DAY, Events.EVENT_TIMEZONE, Events.EVENT_END_TIMEZONE, Events.RRULE, Events.RDATE, Events.EXDATE, Events.AVAILABILITY,
    };

    /** Kopiert alle Termine (inkl. Serien, Ausnahmen, Erinnerungen) aus den Kalendern from in den Kalender to. */
    static JSObject copyCalendars(Context ctx, long[] from, long to) {
        ContentResolver res = ctx.getContentResolver();
        Set<String> existing = new HashSet<>();
        try (Cursor c = res.query(Events.CONTENT_URI, new String[] { Events.TITLE, Events.DTSTART },
                Events.CALENDAR_ID + "=? AND " + Events.DELETED + "=0", new String[] { String.valueOf(to) }, null)) {
            while (c != null && c.moveToNext()) existing.add(c.getString(0) + "|" + c.getLong(1));
        }
        String in = inClause(from);
        Map<Long, Long> ids = new HashMap<>();
        int copied = 0, skipped = 0, exceptions = 0;

        try (Cursor c = res.query(Events.CONTENT_URI, EVENT_COLS,
                Events.CALENDAR_ID + " IN (" + in + ") AND " + Events.DELETED + "=0 AND " + Events.ORIGINAL_ID + " IS NULL", null, null)) {
            while (c != null && c.moveToNext()) {
                String key = c.getString(1) + "|" + c.getLong(4);
                if (existing.contains(key)) {
                    skipped++;
                    continue;
                }
                ContentValues v = new ContentValues();
                v.put(Events.CALENDAR_ID, to);
                copyString(c, 1, v, Events.TITLE);
                copyString(c, 2, v, Events.DESCRIPTION);
                copyString(c, 3, v, Events.EVENT_LOCATION);
                v.put(Events.DTSTART, c.getLong(4));
                v.put(Events.ALL_DAY, c.getInt(7));
                v.put(Events.EVENT_TIMEZONE, c.isNull(8) ? "Europe/Berlin" : c.getString(8));
                copyString(c, 9, v, Events.EVENT_END_TIMEZONE);
                copyString(c, 13, v, Events.AVAILABILITY);
                String rrule = c.getString(10);
                if (rrule != null || !c.isNull(11)) {
                    // Serien brauchen eine Dauer statt eines Endes
                    copyString(c, 10, v, Events.RRULE);
                    copyString(c, 11, v, Events.RDATE);
                    copyString(c, 12, v, Events.EXDATE);
                    String duration = c.getString(6);
                    if (duration == null) {
                        long end = c.isNull(5) ? c.getLong(4) + 3_600_000L : c.getLong(5);
                        duration = c.getInt(7) == 1 ? "P" + Math.max(1, (end - c.getLong(4)) / 86_400_000L) + "D" : "PT" + Math.max(1, (end - c.getLong(4)) / 60_000L) + "M";
                    }
                    v.put(Events.DURATION, duration);
                } else {
                    long end = !c.isNull(5) ? c.getLong(5) : c.getLong(4) + (c.getInt(7) == 1 ? 86_400_000L : 3_600_000L);
                    v.put(Events.DTEND, end);
                }
                Uri uri = res.insert(Events.CONTENT_URI, v);
                if (uri == null) continue;
                long newId = ContentUris.parseId(uri);
                ids.put(c.getLong(0), newId);
                copyReminders(res, c.getLong(0), newId);
                copied++;
            }
        }

        // Geänderte oder abgesagte Einzeltermine von Serien
        try (Cursor c = res.query(Events.CONTENT_URI,
                new String[] { Events.ORIGINAL_ID, Events.ORIGINAL_INSTANCE_TIME, Events.STATUS, Events.TITLE, Events.DTSTART, Events.DTEND, Events.EVENT_LOCATION, Events.DESCRIPTION, Events.ALL_DAY },
                Events.CALENDAR_ID + " IN (" + in + ") AND " + Events.DELETED + "=0 AND " + Events.ORIGINAL_ID + " IS NOT NULL", null, null)) {
            while (c != null && c.moveToNext()) {
                Long master = ids.get(c.getLong(0));
                if (master == null) continue;
                ContentValues v = new ContentValues();
                v.put(Events.ORIGINAL_INSTANCE_TIME, c.getLong(1));
                if (!c.isNull(2)) v.put(Events.STATUS, c.getInt(2));
                copyString(c, 3, v, Events.TITLE);
                if (!c.isNull(4)) v.put(Events.DTSTART, c.getLong(4));
                if (!c.isNull(5)) v.put(Events.DTEND, c.getLong(5));
                copyString(c, 6, v, Events.EVENT_LOCATION);
                copyString(c, 7, v, Events.DESCRIPTION);
                v.put(Events.ALL_DAY, c.getInt(8));
                try {
                    if (res.insert(ContentUris.withAppendedId(Events.CONTENT_EXCEPTION_URI, master), v) != null) exceptions++;
                } catch (Exception ignored) {}
            }
        }
        TerminusWidget.refresh(ctx);
        JSObject r = new JSObject();
        r.put("copied", copied);
        r.put("skipped", skipped);
        r.put("exceptions", exceptions);
        return r;
    }

    private static void copyReminders(ContentResolver res, long oldId, long newId) {
        try (Cursor c = res.query(Reminders.CONTENT_URI, new String[] { Reminders.MINUTES, Reminders.METHOD },
                Reminders.EVENT_ID + "=?", new String[] { String.valueOf(oldId) }, null)) {
            while (c != null && c.moveToNext()) {
                ContentValues v = new ContentValues();
                v.put(Reminders.EVENT_ID, newId);
                v.put(Reminders.MINUTES, c.getInt(0));
                v.put(Reminders.METHOD, c.getInt(1));
                res.insert(Reminders.CONTENT_URI, v);
            }
        } catch (Exception ignored) {}
    }

    /** Anzahl der Termine je Kalender, für die Vorschau im Code-Fenster */
    static JSObject countEvents(Context ctx, long[] calendars) {
        JSObject r = new JSObject();
        int n = 0;
        try (Cursor c = ctx.getContentResolver().query(Events.CONTENT_URI, new String[] { Events._ID },
                Events.CALENDAR_ID + " IN (" + inClause(calendars) + ") AND " + Events.DELETED + "=0 AND " + Events.ORIGINAL_ID + " IS NULL", null, null)) {
            n = c == null ? 0 : c.getCount();
        } catch (Exception ignored) {}
        r.put("count", n);
        return r;
    }

    /* ---------- Kontakte umziehen ---------- */

    /** Konten mit Adressbuch auf dem Gerät, z. B. Google und DAVx⁵ */
    static JSObject addressBooks(Context ctx) {
        Map<String, String[]> found = new HashMap<>();
        ContentResolver res = ctx.getContentResolver();
        Uri[] tables = { RawContacts.CONTENT_URI, ContactsContract.Groups.CONTENT_URI, ContactsContract.Settings.CONTENT_URI };
        for (Uri t : tables) {
            try (Cursor c = res.query(t, new String[] { RawContacts.ACCOUNT_NAME, RawContacts.ACCOUNT_TYPE }, null, null, null)) {
                while (c != null && c.moveToNext()) {
                    if (c.getString(0) != null && c.getString(1) != null) found.put(c.getString(1) + "|" + c.getString(0), new String[] { c.getString(0), c.getString(1) });
                }
            } catch (Exception ignored) {}
        }
        try {
            for (Account a : AccountManager.get(ctx).getAccounts()) {
                if (a.type.contains("address_book") || a.type.equals("com.google")) found.put(a.type + "|" + a.name, new String[] { a.name, a.type });
            }
        } catch (Exception ignored) {}
        JSArray list = new JSArray();
        for (String[] a : found.values()) {
            JSObject o = new JSObject();
            o.put("name", a[0]);
            o.put("type", a[1]);
            o.put("count", countRaw(res, a[0], a[1]));
            list.put(o);
        }
        JSObject r = new JSObject();
        r.put("books", list);
        return r;
    }

    private static int countRaw(ContentResolver res, String name, String type) {
        try (Cursor c = res.query(RawContacts.CONTENT_URI, new String[] { RawContacts._ID },
                RawContacts.ACCOUNT_NAME + "=? AND " + RawContacts.ACCOUNT_TYPE + "=? AND " + RawContacts.DELETED + "=0", new String[] { name, type }, null)) {
            return c == null ? 0 : c.getCount();
        } catch (Exception e) {
            return 0;
        }
    }

    private static final String[] DATA_COLS = {
        Data.MIMETYPE, Data.IS_PRIMARY, Data.IS_SUPER_PRIMARY, Data.DATA1, Data.DATA2, Data.DATA3, Data.DATA4, Data.DATA5, Data.DATA6,
        Data.DATA7, Data.DATA8, Data.DATA9, Data.DATA10, Data.DATA11, Data.DATA12, Data.DATA13, Data.DATA14, Data.DATA15,
    };

    /** Kopiert alle Kontakte eines Kontos (z. B. Google) in ein anderes (z. B. DAVx⁵-Adressbuch). Gleiche Namen werden übersprungen. */
    static JSObject copyContacts(Context ctx, String fromName, String fromType, String toName, String toType) throws Exception {
        ContentResolver res = ctx.getContentResolver();
        Set<String> existing = new HashSet<>();
        try (Cursor c = res.query(RawContacts.CONTENT_URI, new String[] { RawContacts.DISPLAY_NAME_PRIMARY },
                RawContacts.ACCOUNT_NAME + "=? AND " + RawContacts.ACCOUNT_TYPE + "=? AND " + RawContacts.DELETED + "=0", new String[] { toName, toType }, null)) {
            while (c != null && c.moveToNext()) if (c.getString(0) != null) existing.add(c.getString(0));
        }
        int copied = 0, skipped = 0;
        try (Cursor rc = res.query(RawContacts.CONTENT_URI, new String[] { RawContacts._ID, RawContacts.DISPLAY_NAME_PRIMARY },
                RawContacts.ACCOUNT_NAME + "=? AND " + RawContacts.ACCOUNT_TYPE + "=? AND " + RawContacts.DELETED + "=0", new String[] { fromName, fromType }, null)) {
            while (rc != null && rc.moveToNext()) {
                String name = rc.getString(1);
                if (name != null && existing.contains(name)) {
                    skipped++;
                    continue;
                }
                ArrayList<ContentProviderOperation> ops = new ArrayList<>();
                ops.add(ContentProviderOperation.newInsert(RawContacts.CONTENT_URI)
                    .withValue(RawContacts.ACCOUNT_NAME, toName).withValue(RawContacts.ACCOUNT_TYPE, toType).build());
                try (Cursor d = res.query(Data.CONTENT_URI, DATA_COLS, Data.RAW_CONTACT_ID + "=?", new String[] { String.valueOf(rc.getLong(0)) }, null)) {
                    while (d != null && d.moveToNext()) {
                        String mime = d.getString(0);
                        // Gruppen gehören zum alten Konto und lassen sich nicht übertragen
                        if (GroupMembership.CONTENT_ITEM_TYPE.equals(mime)) continue;
                        ContentProviderOperation.Builder b = ContentProviderOperation.newInsert(Data.CONTENT_URI)
                            .withValueBackReference(Data.RAW_CONTACT_ID, 0)
                            .withValue(Data.MIMETYPE, mime)
                            .withValue(Data.IS_PRIMARY, d.getInt(1))
                            .withValue(Data.IS_SUPER_PRIMARY, d.getInt(2));
                        for (int i = 3; i < DATA_COLS.length; i++) {
                            if (d.isNull(i)) continue;
                            if (d.getType(i) == Cursor.FIELD_TYPE_BLOB) b.withValue(DATA_COLS[i], d.getBlob(i));
                            else b.withValue(DATA_COLS[i], d.getString(i));
                        }
                        ops.add(b.build());
                    }
                }
                res.applyBatch(ContactsContract.AUTHORITY, ops);
                copied++;
            }
        }
        JSObject r = new JSObject();
        r.put("copied", copied);
        r.put("skipped", skipped);
        return r;
    }

    private static String inClause(long[] ids) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < ids.length; i++) sb.append(i == 0 ? "" : ",").append(ids[i]);
        return sb.length() == 0 ? "-1" : sb.toString();
    }

    private static void copyString(Cursor c, int i, ContentValues v, String key) {
        if (!c.isNull(i)) v.put(key, c.getString(i));
    }
}
