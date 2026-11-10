package io.github.baum97.terminus;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.view.View;
import android.widget.RemoteViews;
import androidx.core.content.ContextCompat;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Startbildschirm-Widget: die aktuelle Liste aus Terminus (z. B. Einkauf) zum Abhaken.
 * Terminus legt den Stand hier ab (setListWidget). Häkchen im Widget gehen bei Tasks.org/OpenTasks
 * direkt in die geteilte Liste, bei lokalen Listen holt die App sie beim nächsten Öffnen ab.
 */
public class ListWidget extends AppWidgetProvider {

    static final String PREFS = "terminus_list_widget";
    static final String ACTION_TOGGLE = "io.github.baum97.terminus.LIST_TOGGLE";
    private static final int[] ROWS = {
        R.id.list_row1, R.id.list_row2, R.id.list_row3, R.id.list_row4, R.id.list_row5, R.id.list_row6, R.id.list_row7, R.id.list_row8,
    };

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) manager.updateAppWidget(id, build(context));
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (!ACTION_TOGGLE.equals(intent.getAction())) return;
        toggle(context, intent.getStringExtra("id"));
        refresh(context);
    }

    static void refresh(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, ListWidget.class));
        if (ids.length > 0) manager.updateAppWidget(ids, build(context));
    }

    static JSONObject state(Context context) {
        try {
            return new JSONObject(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("state", "{}"));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private static void toggle(Context context, String id) {
        if (id == null) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        try {
            JSONObject st = state(context);
            JSONArray items = st.optJSONArray("items");
            boolean done = false;
            for (int i = 0; items != null && i < items.length(); i++) {
                JSONObject it = items.getJSONObject(i);
                if (id.equals(it.optString("id"))) {
                    done = !it.optBoolean("done");
                    it.put("done", done);
                }
            }
            JSONObject changes = new JSONObject(prefs.getString("changes", "{}"));
            boolean written = false;
            // Geteilte Liste (Tasks.org/OpenTasks): direkt dort abhaken
            if ("d".equals(st.optString("source"))) {
                String[] p = Tasks.find(context);
                if (p != null && ContextCompat.checkSelfPermission(context, p[0].equals("org.tasks.opentasks") ? "org.tasks.permission.WRITE_TASKS" : "org.dmfs.permission.WRITE_TASKS") == PackageManager.PERMISSION_GRANTED) {
                    Tasks.setDone(context, p[0], Long.parseLong(id), done);
                    written = true;
                }
            }
            if (!written) changes.put(id, done);
            prefs.edit().putString("state", st.toString()).putString("changes", changes.toString()).apply();
        } catch (Exception ignored) {}
    }

    static RemoteViews build(Context context) {
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_list);
        Intent open = new Intent(context, MainActivity.class).setAction(TerminusPlugin.ACTION_TASKS);
        v.setOnClickPendingIntent(R.id.list_title, PendingIntent.getActivity(context, 1, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        JSONObject st = state(context);
        JSONArray items = st.optJSONArray("items");
        for (int row : ROWS) v.setViewVisibility(row, View.GONE);
        if (items == null) {
            v.setTextViewText(R.id.list_title, "Liste");
            v.setTextViewText(ROWS[0], "Öffne in Terminus „Aufgaben“, dann erscheint die Liste hier.");
            v.setViewVisibility(ROWS[0], View.VISIBLE);
            v.setOnClickPendingIntent(ROWS[0], PendingIntent.getActivity(context, 2, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
            return v;
        }
        int open_ = 0;
        int n = 0;
        // Offene zuerst
        for (int pass = 0; pass < 2; pass++) {
            for (int i = 0; i < items.length() && n < ROWS.length; i++) {
                JSONObject it = items.optJSONObject(i);
                if (it == null || it.optBoolean("done") != (pass == 1)) continue;
                if (pass == 0) open_++;
                v.setTextViewText(ROWS[n], (it.optBoolean("done") ? "☑  " : "☐  ") + it.optString("text"));
                v.setTextColor(ROWS[n], it.optBoolean("done") ? 0xFF8A93A8 : 0xFF15203A);
                v.setViewVisibility(ROWS[n], View.VISIBLE);
                Intent t = new Intent(context, ListWidget.class).setAction(ACTION_TOGGLE).putExtra("id", it.optString("id"));
                v.setOnClickPendingIntent(ROWS[n], PendingIntent.getBroadcast(context, 100 + n, t, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
                n++;
            }
        }
        v.setTextViewText(R.id.list_title, st.optString("name", "Liste") + (open_ > 0 ? "  ·  " + open_ + " offen" : "  ·  alles erledigt"));
        return v;
    }
}
