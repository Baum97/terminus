package io.github.baum97.terminus;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TerminusPlugin.class);
        super.onCreate(savedInstanceState);
        // Zurück-Taste: die Web-App führt einen Verlauf (offene Fenster, Ansichten).
        // Erst wenn es nichts mehr zurückzugehen gibt, wandert die App in den Hintergrund.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView web = getBridge() != null ? getBridge().getWebView() : null;
                if (web != null && web.canGoBack()) web.goBack();
                else moveTaskToBack(true);
            }
        });
    }
}
