package io.github.baum97.terminus;

import android.Manifest;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.ContentUris;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.CalendarContract.Instances;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Morgen-Überblick: einmal am Tag eine Benachrichtigung mit den Terminen von heute, offenen
 * Mitbringsachen und Fristen von heute und morgen. Wird nach einem Neustart neu geplant.
 */
public class MorningBrief extends BroadcastReceiver {

    private static final String PREFS = "terminus";
    private static final String CHANNEL = "morgen";
    private static final int NOTIFICATION_ID = 7001;
    private static final Pattern FOR = Pattern.compile("^\\s*Für\\s*:\\s*(.+)$", Pattern.MULTILINE);
    private static final Pattern OPEN_ITEM = Pattern.compile("^\\s*☐\\s*(.+)$", Pattern.MULTILINE);

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) show(context, false);
        schedule(context);
    }

    static void save(Context context, boolean enabled, int hour, int minute) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean("brief_enabled", enabled).putInt("brief_hour", hour).putInt("brief_minute", minute).apply();
    }

    private static PendingIntent alarmIntent(Context context) {
        Intent i = new Intent(context, MorningBrief.class).setAction("io.github.baum97.terminus.MORNING");
        return PendingIntent.getBroadcast(context, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** Plant den nächsten Überblick (ungefähr zur gewählten Uhrzeit, ohne Sonderrechte für exakte Wecker). */
    static void schedule(Context context) {
        SharedPreferences p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = alarmIntent(context);
        am.cancel(pi);
        if (!p.getBoolean("brief_enabled", false)) return;
        Calendar next = Calendar.getInstance();
        next.set(Calendar.HOUR_OF_DAY, p.getInt("brief_hour", 7));
        next.set(Calendar.MINUTE, p.getInt("brief_minute", 0));
        next.set(Calendar.SECOND, 0);
        if (next.getTimeInMillis() <= System.currentTimeMillis() + 60_000) next.add(Calendar.DAY_OF_MONTH, 1);
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next.getTimeInMillis(), pi);
    }

    /** Zeigt den Überblick. Ohne Inhalt nur, wenn force (Testknopf). */
    static boolean show(Context context, boolean force) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, "android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) return false;
        List<String> lines = compose(context);
        if (lines.isEmpty() && !force) return false;
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Morgen-Überblick", NotificationManager.IMPORTANCE_DEFAULT));
        }
        Intent open = new Intent(context, MainActivity.class).setAction(TerminusPlugin.ACTION_CALENDAR);
        PendingIntent pi = PendingIntent.getActivity(context, 1, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.InboxStyle style = new NotificationCompat.InboxStyle();
        for (String l : lines) style.addLine(l);
        String title = lines.isEmpty() ? "Heute stehen keine Termine an" : "Heute in Terminus";
        NotificationCompat.Builder b = new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_shortcut_camera)
            .setContentTitle(title)
            .setContentText(lines.isEmpty() ? "Schönen Tag!" : lines.get(0))
            .setStyle(style)
            .setContentIntent(pi)
            .setAutoCancel(true);
        try {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, b.build());
            return true;
        } catch (SecurityException e) {
            return false;
        }
    }

    static List<String> compose(Context context) {
        List<String> lines = new ArrayList<>();
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CALENDAR) != PackageManager.PERMISSION_GRANTED) return lines;
        Calendar today = Calendar.getInstance();
        today.set(Calendar.HOUR_OF_DAY, 0);
        today.set(Calendar.MINUTE, 0);
        today.set(Calendar.SECOND, 0);
        today.set(Calendar.MILLISECOND, 0);
        Calendar end = (Calendar) today.clone();
        end.add(Calendar.DAY_OF_MONTH, 2);
        Uri.Builder ub = Instances.CONTENT_URI.buildUpon();
        ContentUris.appendId(ub, today.getTimeInMillis());
        ContentUris.appendId(ub, end.getTimeInMillis());
        String[] projection = { Instances.TITLE, Instances.BEGIN, Instances.ALL_DAY, Instances.DESCRIPTION };
        SimpleDateFormat time = new SimpleDateFormat("HH:mm", Locale.GERMANY);
        long tomorrow = today.getTimeInMillis() + 86_400_000L;
        SimpleDateFormat utcDay = new SimpleDateFormat("yyyyMMdd", Locale.GERMANY);
        utcDay.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
        String todayKey = new SimpleDateFormat("yyyyMMdd", Locale.GERMANY).format(today.getTime());
        List<String> bring = new ArrayList<>();
        List<String> fristen = new ArrayList<>();
        try (Cursor c = context.getContentResolver().query(ub.build(), projection, Instances.VISIBLE + "=1", null, Instances.BEGIN + " ASC")) {
            while (c != null && c.moveToNext()) {
                String title = c.getString(0) == null ? "Termin" : c.getString(0);
                long begin = c.getLong(1);
                boolean allDay = c.getInt(2) == 1;
                String desc = c.getString(3) == null ? "" : c.getString(3);
                // Ganztägige Termine liegen in UTC: Tag über das UTC-Datum bestimmen
                boolean isToday = allDay ? utcDay.format(new Date(begin)).compareTo(todayKey) <= 0 : begin < tomorrow;
                if (title.endsWith("(Frist)")) {
                    if (!title.startsWith("✓")) fristen.add(title.replace(" (Frist)", "") + (isToday ? " (heute)" : " (morgen)"));
                    continue;
                }
                if (!isToday) continue;
                Matcher f = FOR.matcher(desc);
                String who = f.find() ? " (" + f.group(1).trim() + ")" : "";
                lines.add((allDay ? "Ganztägig" : time.format(new Date(begin))) + "  " + title + who);
                Matcher m = OPEN_ITEM.matcher(desc);
                while (m.find()) bring.add(m.group(1).trim());
            }
        } catch (Exception ignored) {}
        if (!bring.isEmpty()) lines.add("Mitbringen: " + String.join(", ", bring));
        for (String fr : fristen) lines.add("Frist: " + fr);
        return lines;
    }
}
