package io.github.hsniscan.engapp.answers

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * The web app's side of the reminder that asks a card (src/native/widget.ts ReminderAnswers,
 * docs/decisions/0048): plan and cancel those reminders, read the answers given on them and
 * acknowledge the ones it applied.
 */
@CapacitorPlugin(name = "ReminderAnswers")
class ReminderAnswersPlugin : Plugin() {

    @PluginMethod
    fun schedule(call: PluginCall) {
        val arr = call.getArray("notifications") ?: JSArray()
        val list = ArrayList<CardReminder>()
        for (i in 0 until arr.length()) {
            val r = CardReminder.fromJson(arr.optJSONObject(i))
            if (r == null) {
                call.reject("invalid reminder at $i")
                return
            }
            list.add(r)
        }
        CardReminders.schedule(context, list)
        call.resolve()
    }

    @PluginMethod
    fun cancel(call: PluginCall) {
        CardReminders.cancel(context, ids(call))
        call.resolve()
    }

    @PluginMethod
    fun clearShown(call: PluginCall) {
        CardReminders.clearShown(context, ids(call))
        call.resolve()
    }

    @PluginMethod
    fun readQueue(call: PluginCall) {
        val ret = JSObject()
        ret.put("items", AnswerQueue.rawItems(CardReminders.readQueue(context)))
        call.resolve(ret)
    }

    @PluginMethod
    fun ack(call: PluginCall) {
        val arr = call.getArray("ids") ?: JSArray()
        val ids = HashSet<String>()
        for (i in 0 until arr.length()) arr.optString(i, null)?.let { ids.add(it) }
        if (ids.isNotEmpty()) CardReminders.ack(context, ids)
        call.resolve()
    }

    private fun ids(call: PluginCall): List<Int> {
        val arr = call.getArray("ids") ?: JSArray()
        val out = ArrayList<Int>()
        for (i in 0 until arr.length()) {
            val v = arr.opt(i)
            if (v is Number) out.add(v.toInt())
        }
        return out
    }
}
