package io.github.eyalshimshi.newscenter

import android.app.Application

class NewsCenterApplication : Application() {

    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        CrashReporter.install(this)
        container = AppContainer(this)
    }
}
