# R8 rules for the release build (docs/decisions/0064). Libraries ship their own consumer rules
# (Capacitor keeps every Plugin subclass and its @PluginMethod methods; ML Kit, Glance, AndroidX
# and coroutines keep what they need). This file only adds what this app reaches by reflection
# and a few belt-and-braces keeps that a broken release would be costly to discover.

# Readable stack traces in Play Console (the mapping file is bundled into the AAB).
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Capacitor reads @CapacitorPlugin / @PluginMethod / @Permission at run time.
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod

# The JS bridge (Capacitor's MessageHandler) is called from the WebView by name.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# App-local plugins (ShareTarget, EngappTextRecognizer, WidgetBridge, ReminderAnswers) and the
# plugins from node_modules: Capacitor finds them by class name (capacitor.plugins.json) and
# calls their methods by name from JavaScript. Capacitor's consumer rules cover this; repeated
# here so the app never depends on a library keeping its rules file.
-keep public class * extends com.getcapacitor.Plugin { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * { *; }

# Glance instantiates ActionCallback classes by name (actionRunCallback<RevealWordAction>()).
-keep class * implements androidx.glance.appwidget.action.ActionCallback { <init>(); }

# Credential Manager loads its Play-services provider by reflection (native Google sign-in,
# @capawesome/capacitor-google-sign-in). Rule from the Credential Manager documentation.
-if class androidx.credentials.CredentialManager
-keep class androidx.credentials.playservices.** { *; }

# ML Kit / Firebase-style component discovery: registrars are named in manifest meta-data and
# created by reflection. ML Kit's own rules cover this; kept explicitly for the OCR plugin.
-keep class * implements com.google.firebase.components.ComponentRegistrar { <init>(); }
-keep class com.google.mlkit.common.internal.MlKitComponentDiscoveryService { *; }
