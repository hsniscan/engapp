package io.github.hsniscan.engapp.widget

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.action.ActionParameters
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.color.ColorProvider
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.text.FontFamily
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import io.github.hsniscan.engapp.R
import java.util.Locale

/**
 * The app palette (src/ui/tokens/tokens.css), day and night: Glance picks by the system's dark
 * mode, so the widget follows the phone like the app's "Sistem" theme. Warm paper / warm
 * charcoal, ink-blue accent; text pairs meet WCAG AA on the surface.
 */
private object Palette {
    val surface = ColorProvider(day = Color(0xFFFDFCF9), night = Color(0xFF22201D))
    val fg = ColorProvider(day = Color(0xFF1F1D1A), night = Color(0xFFECE6DC))
    val muted = ColorProvider(day = Color(0xFF5E5850), night = Color(0xFFA79F93))
    val accentText = ColorProvider(day = Color(0xFF2A5A8C), night = Color(0xFF9DBDE3))
    val accentSoft = ColorProvider(day = Color(0xFFE6EDF5), night = Color(0xFF253244))
}

private fun card(): GlanceModifier =
    GlanceModifier.fillMaxSize().background(Palette.surface).cornerRadius(20.dp)

/** Strings come from res/values/strings.xml (the widget draws while the app is closed). */
private class Labels(c: Context) {
    val dueWaiting = c.getString(R.string.widget_due_waiting)
    val dueNone = c.getString(R.string.widget_due_none)
    val newWords = c.getString(R.string.widget_due_new)
    val start = c.getString(R.string.widget_due_start)
    val openToUpdate = c.getString(R.string.widget_open_to_update)
    val wordTitle = c.getString(R.string.widget_word_title)
    val tapToReveal = c.getString(R.string.widget_word_tap_reveal)
    val tapToOpen = c.getString(R.string.widget_word_tap_open)
    val noWord = c.getString(R.string.widget_word_none)
    val dueShort = c.getString(R.string.widget_word_due)
}

// ------------------------------------------------------------------ 2×1: due count

class DueWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val view = EngappWidgets.load(context)
        val labels = Labels(context)
        val open = actionStartActivity(EngappWidgets.openIntent(context, WidgetRoutes.STUDY))
        provideContent { DueContent(view, labels, open) }
    }
}

@Composable
private fun DueContent(view: WidgetView, l: Labels, open: androidx.glance.action.Action) {
    val due = view.due
    val line = when {
        due == null -> l.openToUpdate
        due > 0 -> l.dueWaiting
        view.newCount > 0 -> String.format(Locale.ROOT, l.newWords, view.newCount)
        else -> l.dueNone
    }
    Row(
        modifier = card().padding(horizontal = 14.dp, vertical = 8.dp).clickable(open),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = due?.toString() ?: "–",
            style = TextStyle(color = Palette.accentText, fontSize = 28.sp, fontWeight = FontWeight.Bold),
            maxLines = 1,
        )
        Spacer(GlanceModifier.width(10.dp))
        Column {
            Text(text = line, style = TextStyle(color = Palette.muted, fontSize = 12.sp), maxLines = 1)
            Text(
                text = l.start,
                style = TextStyle(color = Palette.fg, fontSize = 14.sp, fontWeight = FontWeight.Medium),
                maxLines = 1,
            )
        }
    }
}

class DueWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = DueWidget()
}

// ------------------------------------------------------------------ 4×2: word of the day

class WordWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val view = EngappWidgets.load(context)
        val labels = Labels(context)
        val word = view.word
        val tap = when {
            word == null -> actionStartActivity(EngappWidgets.openIntent(context, WidgetRoutes.HOME))
            view.revealed -> actionStartActivity(EngappWidgets.openIntent(context, WidgetRoutes.word(word.noteId)))
            else -> actionRunCallback<RevealWordAction>()
        }
        provideContent { WordContent(view, labels, tap) }
    }
}

@Composable
private fun WordContent(view: WidgetView, l: Labels, tap: androidx.glance.action.Action) {
    val word = view.word
    Column(modifier = card().padding(16.dp).clickable(tap)) {
        Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = l.wordTitle,
                style = TextStyle(color = Palette.muted, fontSize = 12.sp, fontWeight = FontWeight.Medium),
                maxLines = 1,
                modifier = GlanceModifier.defaultWeight(),
            )
            view.due?.let { due ->
                Text(
                    text = String.format(Locale.ROOT, l.dueShort, due),
                    style = TextStyle(color = Palette.accentText, fontSize = 12.sp, fontWeight = FontWeight.Medium),
                    maxLines = 1,
                    modifier = GlanceModifier.background(Palette.accentSoft).cornerRadius(10.dp)
                        .padding(horizontal = 8.dp, vertical = 2.dp),
                )
            }
        }
        Spacer(GlanceModifier.height(8.dp))
        when {
            word == null -> Text(text = l.noWord, style = TextStyle(color = Palette.muted, fontSize = 14.sp), maxLines = 3)
            !view.revealed -> {
                // The Turkish meaning first: look, try to recall the English word, then tap.
                Text(
                    text = word.tr,
                    style = TextStyle(color = Palette.fg, fontSize = 20.sp, fontWeight = FontWeight.Medium),
                    maxLines = 2,
                )
                Spacer(GlanceModifier.height(6.dp))
                Text(text = l.tapToReveal, style = TextStyle(color = Palette.accentText, fontSize = 12.sp), maxLines = 1)
            }
            else -> {
                Text(
                    text = word.en,
                    style = TextStyle(
                        color = Palette.fg,
                        fontSize = 24.sp,
                        fontWeight = FontWeight.Bold,
                        fontFamily = FontFamily.Serif,
                    ),
                    maxLines = 1,
                )
                Text(text = word.tr, style = TextStyle(color = Palette.muted, fontSize = 14.sp), maxLines = 2)
                Spacer(GlanceModifier.height(6.dp))
                Text(text = l.tapToOpen, style = TextStyle(color = Palette.accentText, fontSize = 12.sp), maxLines = 1)
            }
        }
    }
}

/** First tap on the word: turn it over (the next tap opens the app on that word). */
class RevealWordAction : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        EngappWidgets.setRevealed(context, EngappWidgets.load(context).revealKey)
        WordWidget().update(context, glanceId)
    }
}

class WordWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = WordWidget()
}
