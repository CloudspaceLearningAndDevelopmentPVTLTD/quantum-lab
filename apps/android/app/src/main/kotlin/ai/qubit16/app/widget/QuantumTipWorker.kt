package ai.qubit16.app.widget

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.glance.appwidget.updateAll
import java.time.Duration
import java.time.LocalDateTime
import java.time.LocalTime
import java.util.concurrent.TimeUnit

/**
 * Recomposes the Quantum Tip widget once a day, near local midnight. Glance
 * widgets do not repaint themselves on a schedule the way a live wallpaper
 * might — `updateAll` is the only way to make `provideGlance` (which reads
 * "today" live) run again, so this worker's entire job is to call it at
 * roughly the right time.
 *
 * A failed or delayed run is harmless: the widget just shows yesterday's tip
 * a little longer, and the next successful run corrects it. No data to lose,
 * nothing to retry aggressively for.
 */
class QuantumTipWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        return try {
            QuantumTipWidget().updateAll(applicationContext)
            Result.success()
        } catch (t: Throwable) {
            Result.retry()
        }
    }

    companion object {
        private const val UNIQUE_WORK_NAME = "quantum-tip-daily-refresh"

        fun schedule(context: Context) {
            val now = LocalDateTime.now()
            val nextMidnight = now.toLocalDate().plusDays(1).atTime(LocalTime.MIDNIGHT)
            val initialDelay = Duration.between(now, nextMidnight)

            val request = PeriodicWorkRequestBuilder<QuantumTipWorker>(1, TimeUnit.DAYS)
                .setInitialDelay(initialDelay.toMillis(), TimeUnit.MILLISECONDS)
                .build()

            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                UNIQUE_WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                request,
            )
        }
    }
}
