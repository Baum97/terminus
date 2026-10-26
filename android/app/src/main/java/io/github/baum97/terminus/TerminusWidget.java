package io.github.baum97.terminus;

import android.Manifest;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.ContentUris;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.provider.CalendarContract.Instances;
import android.view.View;
import android.widget.RemoteViews;
import androidx.core.content.ContextCompat;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/** Startbildschirm-Widget: die nächsten Termine von heute und morgen aus allen sichtbaren Kalendern. */
public class TerminusWidget extends AppWidgetProvider {

    private static final int[] ROWS = { R.id.widget_row1, R.id.widget_row2, R.id.widget_row3, R.id.widget_row4, R.id.widget_row5 };

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) manager.updateAppWidget(id, build(context));
    }

    /** Nach jeder Änderung durch Terminus aufrufen, damit das Widget sofort stimmt. */
    static void refresh(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, TerminusWidget.class));
        if (ids.length > 0) manager.updateAppWidget(ids, build(context));
    }

    static RemoteViews build(Context context) {
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_today);
        Intent open = new Intent(context, MainActivity.class).setAction(TerminusPlugin.ACTION_CALENDAR);
        PendingIntent pi = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        v.setOnClickPendingIntent(R.id.widget_root, pi);

        Calendar today = Calendar.getInstance();
        today.set(Calendar.HOUR_OF_DAY, 0);
        today.set(Calendar.MINUTE, 0);
        today.set(Calendar.SECOND, 0);
        today.set(Calendar.MILLISECOND, 0);
        v.setTextViewText(R.id.widget_title, new SimpleDateFormat("EEEE, d. MMMM", Locale.GERMANY).format(today.getTime()));
        for (int row : ROWS) v.setViewVisibility(row, View.GONE);

        if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CALENDAR) != PackageManager.PERMISSION_GRANTED) {
            show(v, 0, "Tippen und Kalender freigeben");
            return v;
        }

        long now = System.currentTimeMillis();
        long from = today.getTimeInMillis();
        Calendar end = (Calendar) today.clone();
        end.add(Calendar.DAY_OF_MONTH, 2);
        Uri.Builder b = Instances.CONTENT_URI.buildUpon();
        ContentUris.appendId(b, from);
        ContentUris.appendId(b, end.getTimeInMillis());
        String[] projection = { Instances.TITLE, Instances.BEGIN, Instances.END, Instances.ALL_DAY };
        SimpleDateFormat time = new SimpleDateFormat("HH:mm", Locale.GERMANY);
        SimpleDateFormat utcDay = new SimpleDateFormat("yyyyMMdd", Locale.GERMANY);
        utcDay.setTimeZone(TimeZone.getTimeZone("UTC"));
        SimpleDateFormat localDay = new SimpleDateFormat("yyyyMMdd", Locale.GERMANY);
        String todayKey = localDay.format(today.getTime());

        int n = 0;
        try (Cursor c = context.getContentResolver().query(b.build(), projection, Instances.VISIBLE + "=1", null, Instances.ALL_DAY + " DESC, " + Instances.BEGIN + " ASC")) {
            while (c != null && c.moveToNext() && n < ROWS.length) {
                long begin = c.getLong(1), stop = c.getLong(2);
                boolean allDay = c.getInt(3) == 1;
                if (!allDay && stop < now) continue;
                String day = allDay ? utcDay.format(new Date(begin)) : localDay.format(new Date(begin));
                String when = (day.equals(todayKey) ? "Heute" : "Morgen") + (allDay ? "" : " " + time.format(new Date(begin)));
                show(v, n++, when + "  ·  " + (c.getString(0) == null ? "Termin" : c.getString(0)));
            }
        } catch (Exception ignored) {}
        if (n == 0) show(v, 0, "Heute und morgen keine Termine");
        return v;
    }

    private static void show(RemoteViews v, int index, String text) {
        v.setTextViewText(ROWS[index], text);
        v.setViewVisibility(ROWS[index], View.VISIBLE);
    }
}
