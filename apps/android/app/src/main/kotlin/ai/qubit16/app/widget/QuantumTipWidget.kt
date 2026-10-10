package ai.qubit16.app.widget

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.appWidgetBackground
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.cornerRadius
import androidx.glance.background
import androidx.glance.layout.Column
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import ai.qubit16.app.LauncherActivity
import ai.qubit16.app.R
import java.time.LocalDate

/**
 * The "Quantum Tip" home-screen widget. Entirely native (Jetpack Glance —
 * Compose for App Widgets, the current recommended widget API, replacing
 * hand-written RemoteViews), entirely offline: it reads GlossaryTips.kt, not
 * the network or the web app's storage.
 *
 * Colours are read from the same @color resources the rest of the app uses
 * (colors.xml), which are themselves copied from apps/web's dark-theme
 * tokens, so the widget can never drift into an off-brand palette.
 *
 * Tapping it opens the real glossary entry in the app (LauncherActivity ->
 * verified https://qubit16.ai/glossary#<id>) — the widget is a native teaser
 * for a real web page, not a duplicate of one.
 */
class QuantumTipWidget : GlanceAppWidget() {

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val tip = GlossaryTips.forDayOfYear(LocalDate.now().dayOfYear)
        provideContent {
            Content(context, tip)
        }
    }

    @Composable
    private fun Content(context: Context, tip: GlossaryTip) {
        val openIntent = Intent(context, LauncherActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            data = Uri.parse("https://qubit16.ai/glossary${tip.path}")
        }

        Column(
            modifier = GlanceModifier
                .fillMaxSize()
                .appWidgetBackground()
                .background(ColorProvider(R.color.widgetBackground))
                .cornerRadius(20.dp)
                .clickable(actionStartActivity(openIntent))
                .padding(14.dp),
        ) {
            Text(
                text = "QUANTUM TIP",
                style = TextStyle(
                    color = ColorProvider(R.color.widgetAccent),
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                ),
            )
            Spacer(modifier = GlanceModifier.height(4.dp))
            Text(
                text = tip.term,
                style = TextStyle(
                    color = ColorProvider(R.color.widgetOnBackground),
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold,
                ),
            )
            Spacer(modifier = GlanceModifier.height(2.dp))
            Text(
                text = tip.short,
                maxLines = 3,
                style = TextStyle(
                    color = ColorProvider(R.color.widgetOnBackground),
                    fontSize = 12.sp,
                ),
            )
        }
    }
}
