# Capacitor plugin reflection
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keep class com.getcapacitor.** { *; }
-keepclassmembers class * {
    @com.getcapacitor.annotation.PluginMethod *;
    @com.getcapacitor.annotation.ActivityCallback *;
}

# Keep Wyre app classes
-keep class com.wyre.app.** { *; }

# JSON
-keep class org.json.** { *; }
