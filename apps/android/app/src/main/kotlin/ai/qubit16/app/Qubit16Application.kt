package ai.qubit16.app

import android.app.Application
import ai.qubit16.app.widget.QuantumTipWorker

/**
 * Schedules the one piece of genuinely native background work this app does:
 * rotating the home-screen widget's daily tip. Everything else is the web
 * app, which manages its own state (localStorage, Supabase) with no help
 * from this process.
 */
class Qubit16Application : Application() {
    override fun onCreate() {
        super.onCreate()
        QuantumTipWorker.schedule(this)
    }
}
