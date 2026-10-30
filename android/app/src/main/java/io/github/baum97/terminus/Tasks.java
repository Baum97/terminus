package io.github.baum97.terminus;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

// Listen und Aufgaben über die offene OpenTasks-Schnittstelle. Bereitgestellt von Tasks.org,
// OpenTasks oder jtx Board; DAVx⁵ gleicht sie per CalDAV (VTODO) mit dem Anbieter ab.
final class Tasks {
    private Tasks() {}

    // Anbieter in der Reihenfolge, in der Terminus sie nutzt: Schnittstelle → Berechtigungs-Alias
    static final String[][] PROVIDERS = {
        { "org.tasks.opentasks", "tasksOrg", "Tasks.org" },
        { "org.dmfs.tasks", "tasksDmfs", "OpenTasks" },
    };

    static final int STATUS_NEEDS_ACTION = 0;
    static final int STATUS_COMPLETED = 2;

    static String[] find(Context ctx) {
        for (String[] p : PROVIDERS) {
            if (ctx.getPackageManager().resolveContentProvider(p[0], 0) != null) return p;
        }
        return null;
    }

    private static Uri lists(String authority) {
        return Uri.parse("content://" + authority + "/tasklists");
    }

    private static Uri tasks(String authority) {
        return Uri.parse("content://" + authority + "/tasks");
    }

    static JSArray taskLists(Context ctx, String authority) {
        JSArray out = new JSArray();
        String[] projection = { "_id", "list_name", "list_color", "account_name", "account_type" };
        try (Cursor c = ctx.getContentResolver().query(lists(authority), projection, "visible=1", null, "list_name")) {
            while (c != null && c.moveToNext()) {
                JSObject l = new JSObject();
                l.put("id", String.valueOf(c.getLong(0)));
                l.put("name", c.getString(1));
                l.put("color", String.format("#%06X", 0xFFFFFF & c.getInt(2)));
                l.put("account", c.getString(3));
                l.put("accountType", c.getString(4));
                out.put(l);
            }
        }
        return out;
    }

    static JSArray items(Context ctx, String authority, long listId) {
        JSArray out = new JSArray();
        String[] projection = { "_id", "title", "status", "due", "description" };
        String where = "list_id=? AND _deleted=0 AND status!=3";
        try (Cursor c = ctx.getContentResolver().query(tasks(authority), projection, where, new String[] { String.valueOf(listId) }, "status ASC, _id ASC")) {
            while (c != null && c.moveToNext()) {
                JSObject t = new JSObject();
                t.put("id", String.valueOf(c.getLong(0)));
                t.put("text", c.getString(1));
                t.put("done", c.getInt(2) == STATUS_COMPLETED);
                if (!c.isNull(3)) t.put("due", c.getLong(3));
                t.put("notes", c.getString(4));
                out.put(t);
            }
        }
        return out;
    }

    static long add(Context ctx, String authority, long listId, String title, Long due) {
        ContentValues v = new ContentValues();
        v.put("list_id", listId);
        v.put("title", title);
        v.put("status", STATUS_NEEDS_ACTION);
        if (due != null) {
            v.put("due", due);
            v.put("is_allday", 1);
            v.put("tz", "UTC");
        }
        Uri uri = ctx.getContentResolver().insert(tasks(authority), v);
        return uri == null ? -1 : ContentUris.parseId(uri);
    }

    static void setDone(Context ctx, String authority, long id, boolean done) {
        ContentValues v = new ContentValues();
        v.put("status", done ? STATUS_COMPLETED : STATUS_NEEDS_ACTION);
        v.put("percent_complete", done ? 100 : 0);
        if (done) v.put("completed", System.currentTimeMillis());
        else v.putNull("completed");
        ctx.getContentResolver().update(ContentUris.withAppendedId(tasks(authority), id), v, null, null);
    }

    static void delete(Context ctx, String authority, long id) {
        ContentResolver r = ctx.getContentResolver();
        r.delete(ContentUris.withAppendedId(tasks(authority), id), null, null);
    }
}
