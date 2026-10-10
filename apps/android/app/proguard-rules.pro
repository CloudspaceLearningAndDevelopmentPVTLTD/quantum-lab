# androidbrowserhelper and androidx.browser reflectively look up a handful of
# their own classes at runtime to talk to the installed browser; the AARs
# ship their own consumer-rules.pro for the rest, these cover the app's own
# reflectively-referenced pieces.
-keep class ai.qubit16.app.LauncherActivity { *; }
-keep class ai.qubit16.app.widget.QuantumTipWidgetReceiver { *; }
-keep class ai.qubit16.app.widget.QuantumTipWorker { *; }
-keepclassmembers class ai.qubit16.app.widget.QuantumTipWorker {
    public <init>(android.content.Context, androidx.work.WorkerParameters);
}
