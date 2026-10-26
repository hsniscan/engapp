package io.github.hsniscan.engapp;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Rect;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * "Fotoğraftan metin" on Android (docs/decisions/0045-ocr.md): Google ML Kit Text Recognition v2,
 * Latin script, bundled model (com.google.mlkit:text-recognition), so it works offline and the
 * photo never leaves the phone. The web app hands over the photo it already scaled and
 * oriented (src/features/ocr/image.ts) as base64 JPEG; the result is blocks of lines with boxes
 * in that image's pixels and a 0..1 confidence per line.
 */
@CapacitorPlugin(name = "EngappTextRecognizer")
public class TextRecognizerPlugin extends Plugin {

    /** The bridge sends at most a few MB; anything far larger is not a photo we made. */
    private static final int MAX_BASE64_CHARS = 24 * 1024 * 1024;

    private final ExecutorService decoder = Executors.newSingleThreadExecutor();
    private TextRecognizer recognizer;

    private synchronized TextRecognizer recognizer() {
        if (recognizer == null) {
            recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        }
        return recognizer;
    }

    @PluginMethod
    public void recognize(PluginCall call) {
        String data = call.getString("base64");
        if (data == null || data.isEmpty()) {
            call.reject("No image", "NO_IMAGE");
            return;
        }
        if (data.length() > MAX_BASE64_CHARS) {
            call.reject("Image too large", "TOO_LARGE");
            return;
        }
        decoder.execute(() -> {
            Bitmap decoded;
            try {
                int comma = data.indexOf(',');
                String raw = comma >= 0 && data.startsWith("data:") ? data.substring(comma + 1) : data;
                byte[] bytes = Base64.decode(raw, Base64.DEFAULT);
                decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            } catch (IllegalArgumentException e) {
                call.reject("Bad image", "BAD_IMAGE", e);
                return;
            }
            if (decoded == null) {
                call.reject("Bad image", "BAD_IMAGE");
                return;
            }
            final Bitmap bitmap = decoded;
            final int width = bitmap.getWidth();
            final int height = bitmap.getHeight();
            InputImage image = InputImage.fromBitmap(bitmap, 0);
            recognizer()
                .process(image)
                .addOnSuccessListener(text -> {
                    call.resolve(toJs(text, width, height));
                    bitmap.recycle();
                })
                .addOnFailureListener(e -> {
                    call.reject("Recognition failed", "FAILED", e);
                    bitmap.recycle();
                });
        });
    }

    private static JSObject box(Rect r) {
        JSObject o = new JSObject();
        o.put("x", r == null ? 0 : r.left);
        o.put("y", r == null ? 0 : r.top);
        o.put("w", r == null ? 0 : r.width());
        o.put("h", r == null ? 0 : r.height());
        return o;
    }

    static JSObject toJs(Text text, int width, int height) {
        JSArray blocks = new JSArray();
        for (Text.TextBlock b : text.getTextBlocks()) {
            JSArray lines = new JSArray();
            for (Text.Line l : b.getLines()) {
                JSObject line = new JSObject();
                line.put("text", l.getText());
                line.put("box", box(l.getBoundingBox()));
                line.put("confidence", (double) l.getConfidence());
                lines.put(line);
            }
            JSObject block = new JSObject();
            block.put("box", box(b.getBoundingBox()));
            block.put("lines", lines);
            blocks.put(block);
        }
        JSObject out = new JSObject();
        out.put("width", width);
        out.put("height", height);
        out.put("blocks", blocks);
        return out;
    }

    @Override
    protected void handleOnDestroy() {
        synchronized (this) {
            if (recognizer != null) recognizer.close();
            recognizer = null;
        }
        decoder.shutdown();
        super.handleOnDestroy();
    }
}
