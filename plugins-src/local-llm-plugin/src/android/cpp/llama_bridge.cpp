// JNI bridge between LlamaBridge.kt and llama.cpp. Written against the API in
// llama.cpp/include/llama.h as vendored (see ../../../README.md) — llama.cpp's C API
// has changed shape several times over its history, so if you update the vendored
// checkout, diff this file against the new header before assuming it still compiles.
//
// Single-turn only by design: each chat() call allocates a fresh context, runs one
// prompt-in/answer-out pass, and tears the context down. AssistantOrchestratorService
// calls this twice per voice command (plan tool call, then phrase the answer) with no
// shared state expected between calls, so there's no KV-cache/context to manage across
// turns — see local-llm-plugin/README.md.

#include <jni.h>
#include <string>
#include <vector>
#include <chrono>
#include <android/log.h>
#include "llama.h"
#include "mtmd.h"
#include "mtmd-helper.h"

#define LOG_TAG "LlamaBridge"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

namespace {

llama_model* g_model = nullptr;
bool g_backend_initialized = false;

// Without this, llama.cpp/ggml/mtmd's internal LOG_ERR/LOG_WRN calls go to
// unredirected stderr and never reach logcat at all — diagnosing a real failure
// (e.g. mtmd_tokenize returning a bare error code) needs this wired up first.
void androidLogCallback(ggml_log_level level, const char* text, void* /*user_data*/) {
    int prio = (level == GGML_LOG_LEVEL_ERROR) ? ANDROID_LOG_ERROR
             : (level == GGML_LOG_LEVEL_WARN)  ? ANDROID_LOG_WARN
             : ANDROID_LOG_INFO;
    __android_log_print(prio, LOG_TAG, "%s", text);
}

// Vision (SmolVLM) — a separate model + mtmd context from the text-only g_model
// above. Loaded independently since photo description is a distinct capability from
// the tool-routing/chat flow the rest of this file serves.
llama_model* g_vision_model = nullptr;
mtmd_context* g_mtmd_ctx = nullptr;

constexpr int32_t kContextSize = 2048;
// Both calls per turn (plan a tool call, phrase a one-or-two-sentence answer) are
// short by design — capping well below 256 measurably cuts worst-case latency on
// phone CPUs without truncating either kind of response in practice.
constexpr int32_t kMaxResponseTokens = 100;
// The Nothing 4a's 8-core CPU is a big.LITTLE mix; llama_context_default_params()
// otherwise leaves n_threads at a conservative default that doesn't use it well.
constexpr int32_t kInferenceThreads = 4;

std::string runInference(const std::string& prompt) {
    if (g_model == nullptr) {
        return "";
    }
    const llama_vocab* vocab = llama_model_get_vocab(g_model);

    // Format the prompt through the model's own chat template (falls back to a
    // generic one if the model doesn't declare one) rather than sending raw text —
    // small instruct models are noticeably worse at following the JSON-only
    // instruction without their expected chat wrapper.
    const char* tmpl = llama_model_chat_template(g_model, nullptr);
    // Qwen3 defaults to a verbose chain-of-thought ("thinking") mode that would blow
    // through kMaxResponseTokens before ever reaching the actual JSON/answer — its
    // documented mitigation is this literal suffix, which non-Qwen3 models will just
    // see as harmless trailing text.
    const std::string promptWithSuffix = prompt + " /no_think";
    llama_chat_message msg{"user", promptWithSuffix.c_str()};
    std::vector<char> formatted(prompt.size() * 2 + 256);
    int32_t formattedLen = llama_chat_apply_template(
        tmpl, &msg, 1, /*add_ass=*/true, formatted.data(), (int32_t) formatted.size());
    if (formattedLen > (int32_t) formatted.size()) {
        formatted.resize(formattedLen);
        formattedLen = llama_chat_apply_template(
            tmpl, &msg, 1, true, formatted.data(), (int32_t) formatted.size());
    }
    const std::string formattedPrompt(formatted.data(), formattedLen);

    using clock = std::chrono::steady_clock;
    auto t0 = clock::now();

    llama_context_params ctxParams = llama_context_default_params();
    ctxParams.n_ctx = kContextSize;
    ctxParams.n_batch = kContextSize;
    ctxParams.n_threads = kInferenceThreads;
    ctxParams.n_threads_batch = kInferenceThreads;
    llama_context* ctx = llama_init_from_model(g_model, ctxParams);
    if (ctx == nullptr) {
        LOGE("Failed to create context");
        return "";
    }
    auto t1 = clock::now();
    LOGI("PERF ctx_create=%lldms",
         (long long) std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0).count());

    std::vector<llama_token> tokens(formattedPrompt.size() + 16);
    int32_t nTokens = llama_tokenize(
        vocab, formattedPrompt.c_str(), (int32_t) formattedPrompt.size(),
        tokens.data(), (int32_t) tokens.size(), /*add_special=*/true, /*parse_special=*/true);
    if (nTokens < 0) {
        tokens.resize(-nTokens);
        nTokens = llama_tokenize(
            vocab, formattedPrompt.c_str(), (int32_t) formattedPrompt.size(),
            tokens.data(), (int32_t) tokens.size(), true, true);
    }
    tokens.resize(nTokens);
    LOGI("PERF n_prompt_tokens=%d n_threads=%d", nTokens, kInferenceThreads);

    llama_sampler_chain_params sparams = llama_sampler_chain_default_params();
    llama_sampler* sampler = llama_sampler_chain_init(sparams);
    // Low temperature: this is JSON tool-call planning and short answer phrasing,
    // not creative writing — determinism matters more than variety here.
    llama_sampler_chain_add(sampler, llama_sampler_init_temp(0.3f));
    llama_sampler_chain_add(sampler, llama_sampler_init_dist(/*seed=*/1234));

    std::string result;
    llama_batch batch = llama_batch_get_one(tokens.data(), (int32_t) tokens.size());

    int32_t nGenerated = 0;
    auto t2 = clock::now();
    long long prefillMs = 0;
    for (int32_t i = 0; i < kMaxResponseTokens; i++) {
        if (llama_decode(ctx, batch) != 0) {
            LOGE("llama_decode failed at step %d", i);
            break;
        }
        if (i == 0) {
            auto tPrefill = clock::now();
            prefillMs = std::chrono::duration_cast<std::chrono::milliseconds>(tPrefill - t2).count();
            LOGI("PERF prefill=%lldms (%d tokens)", prefillMs, nTokens);
            t2 = tPrefill;
        }

        llama_token newToken = llama_sampler_sample(sampler, ctx, -1);
        llama_sampler_accept(sampler, newToken);
        nGenerated++;

        if (llama_vocab_is_eog(vocab, newToken)) {
            break;
        }

        char piece[256];
        int32_t pieceLen = llama_token_to_piece(vocab, newToken, piece, sizeof(piece), 0, true);
        if (pieceLen > 0) {
            result.append(piece, pieceLen);
        }

        // Feed the sampled token back in as the next single-token batch.
        static llama_token nextToken;
        nextToken = newToken;
        batch = llama_batch_get_one(&nextToken, 1);
    }
    auto t3 = clock::now();
    long long genMs = std::chrono::duration_cast<std::chrono::milliseconds>(t3 - t2).count();
    LOGI("PERF generate=%lldms n_tokens=%d (%.2f tok/s)",
         genMs, nGenerated, nGenerated > 0 ? nGenerated * 1000.0 / (double) genMs : 0.0);
    LOGI("RESULT: %s", result.c_str());

    llama_sampler_free(sampler);
    llama_free(ctx);
    return result;
}

std::string describeImageInternal(const std::string& imagePath, const std::string& prompt) {
    if (g_vision_model == nullptr || g_mtmd_ctx == nullptr) {
        LOGE("Vision model not loaded");
        return "";
    }

    llama_context_params ctxParams = llama_context_default_params();
    ctxParams.n_ctx = 4096; // image tokens can easily exceed the 2048 used for text-only chat
    ctxParams.n_batch = 1024;
    ctxParams.n_threads = kInferenceThreads;
    ctxParams.n_threads_batch = kInferenceThreads;
    llama_context* ctx = llama_init_from_model(g_vision_model, ctxParams);
    if (ctx == nullptr) {
        LOGE("Failed to create vision context");
        return "";
    }

    mtmd_helper_bitmap_wrapper bmp = mtmd_helper_bitmap_init_from_file(
        g_mtmd_ctx, imagePath.c_str(), /*placeholder=*/false, mtmd_helper_init_opt_default());
    if (bmp.bitmap == nullptr) {
        LOGE("Failed to load image: %s", imagePath.c_str());
        llama_free(ctx);
        return "";
    }

    // The media marker tells mtmd_tokenize() where in the text to splice in the
    // image's tokens — without it the image would just be appended, which most
    // vision chat templates don't expect.
    const std::string promptWithMarker =
        // mtmd_default_marker() is a generic fallback string, not necessarily what
        // THIS model's vision context actually expects — mtmd_get_marker(ctx) is the
        // one that matches SmolVLM/Idefics3's configured marker. Using the wrong one
        // silently produces "number of media markers in text (0) does not match
        // number of bitmaps (1)" since the literal substring never appears.
        std::string(mtmd_get_marker(g_mtmd_ctx)) + "\n" + prompt;

    // Without applying the chat template, the model sees raw text with no signal
    // that it's meant to respond as an assistant — it immediately emits an
    // end-of-generation token, producing empty output (found via IMAGE RESULT: <empty>
    // in logs despite the image itself encoding and decoding successfully).
    const char* visionTmpl = llama_model_chat_template(g_vision_model, nullptr);
    llama_chat_message visionMsg{"user", promptWithMarker.c_str()};
    std::vector<char> visionFormatted(promptWithMarker.size() * 2 + 256);
    int32_t visionFormattedLen = llama_chat_apply_template(
        visionTmpl, &visionMsg, 1, /*add_ass=*/true, visionFormatted.data(), (int32_t) visionFormatted.size());
    if (visionFormattedLen > (int32_t) visionFormatted.size()) {
        visionFormatted.resize(visionFormattedLen);
        visionFormattedLen = llama_chat_apply_template(
            visionTmpl, &visionMsg, 1, true, visionFormatted.data(), (int32_t) visionFormatted.size());
    }
    const std::string visionFormattedPrompt(visionFormatted.data(), visionFormattedLen);

    // mtmd_input_text has 4 fields (text, text_len, add_special, parse_special) —
    // omitting text_len here previously shifted every value by one field, silently
    // truncating the prompt to 1 byte (the value meant for add_special landed in
    // text_len instead). That's what caused "number of media markers in text (0)".
    mtmd_input_text text{
        visionFormattedPrompt.c_str(), visionFormattedPrompt.size(),
        /*add_special=*/true, /*parse_special=*/true};
    mtmd_input_chunks* chunks = mtmd_input_chunks_init();
    const mtmd_bitmap* bitmaps[] = {bmp.bitmap};
    int32_t tokenizeResult = mtmd_tokenize(g_mtmd_ctx, chunks, &text, bitmaps, 1);
    mtmd_bitmap_free(bmp.bitmap);
    if (tokenizeResult != 0) {
        LOGE("mtmd_tokenize failed: %d", tokenizeResult);
        mtmd_input_chunks_free(chunks);
        llama_free(ctx);
        return "";
    }

    llama_pos newNPast = 0;
    int32_t evalResult = mtmd_helper_eval_chunks(
        g_mtmd_ctx, ctx, chunks, /*n_past=*/0, /*seq_id=*/0,
        ctxParams.n_batch, /*logits_last=*/true, &newNPast);
    mtmd_input_chunks_free(chunks);
    if (evalResult != 0) {
        LOGE("mtmd_helper_eval_chunks failed: %d", evalResult);
        llama_free(ctx);
        return "";
    }

    const llama_vocab* vocab = llama_model_get_vocab(g_vision_model);
    llama_sampler_chain_params sparams = llama_sampler_chain_default_params();
    llama_sampler* sampler = llama_sampler_chain_init(sparams);
    llama_sampler_chain_add(sampler, llama_sampler_init_temp(0.4f));
    llama_sampler_chain_add(sampler, llama_sampler_init_dist(/*seed=*/1234));

    std::string result;
    llama_pos pos = newNPast;
    for (int32_t i = 0; i < kMaxResponseTokens; i++) {
        llama_token newToken = llama_sampler_sample(sampler, ctx, -1);
        llama_sampler_accept(sampler, newToken);
        if (llama_vocab_is_eog(vocab, newToken)) {
            break;
        }
        char piece[256];
        int32_t pieceLen = llama_token_to_piece(vocab, newToken, piece, sizeof(piece), 0, true);
        if (pieceLen > 0) {
            result.append(piece, pieceLen);
        }

        llama_batch batch = llama_batch_get_one(&newToken, 1);
        batch.pos = &pos;
        if (llama_decode(ctx, batch) != 0) {
            LOGE("llama_decode failed at image-answer step %d", i);
            break;
        }
        pos++;
    }

    LOGI("IMAGE RESULT: %s", result.c_str());
    llama_sampler_free(sampler);
    llama_free(ctx);
    return result;
}

}  // namespace

extern "C" JNIEXPORT jboolean JNICALL
Java_com_nothing_voiceagent_localllm_LlamaBridge_loadModel(JNIEnv* env, jobject /*thiz*/, jstring modelPath) {
    if (!g_backend_initialized) {
        llama_backend_init();
        llama_log_set(&androidLogCallback, nullptr);
        mtmd_helper_log_set(&androidLogCallback, nullptr);
        g_backend_initialized = true;
    }
    if (g_model != nullptr) {
        llama_model_free(g_model);
        g_model = nullptr;
    }

    const char* path = env->GetStringUTFChars(modelPath, nullptr);
    llama_model_params params = llama_model_default_params();
    // n_gpu_layers stays 0 (CPU-only) — the Nothing 4a has no GPU delegate wired up
    // for llama.cpp's Android build path; revisit if OpenCL/Vulkan backend is added.
    g_model = llama_model_load_from_file(path, params);
    env->ReleaseStringUTFChars(modelPath, path);

    if (g_model == nullptr) {
        LOGE("Failed to load model");
        return JNI_FALSE;
    }
    LOGI("Model loaded successfully");
    return JNI_TRUE;
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_nothing_voiceagent_localllm_LlamaBridge_chat(JNIEnv* env, jobject /*thiz*/, jstring prompt) {
    const char* promptChars = env->GetStringUTFChars(prompt, nullptr);
    std::string result = runInference(std::string(promptChars));
    env->ReleaseStringUTFChars(prompt, promptChars);
    return env->NewStringUTF(result.c_str());
}

extern "C" JNIEXPORT void JNICALL
Java_com_nothing_voiceagent_localllm_LlamaBridge_unloadModel(JNIEnv* /*env*/, jobject /*thiz*/) {
    if (g_model != nullptr) {
        llama_model_free(g_model);
        g_model = nullptr;
    }
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_nothing_voiceagent_localllm_LlamaBridge_loadVisionModel(
    JNIEnv* env, jobject /*thiz*/, jstring modelPath, jstring mmprojPath) {
    if (!g_backend_initialized) {
        llama_backend_init();
        llama_log_set(&androidLogCallback, nullptr);
        mtmd_helper_log_set(&androidLogCallback, nullptr);
        g_backend_initialized = true;
    }
    if (g_mtmd_ctx != nullptr) {
        mtmd_free(g_mtmd_ctx);
        g_mtmd_ctx = nullptr;
    }
    if (g_vision_model != nullptr) {
        llama_model_free(g_vision_model);
        g_vision_model = nullptr;
    }

    const char* path = env->GetStringUTFChars(modelPath, nullptr);
    llama_model_params params = llama_model_default_params();
    g_vision_model = llama_model_load_from_file(path, params);
    env->ReleaseStringUTFChars(modelPath, path);
    if (g_vision_model == nullptr) {
        LOGE("Failed to load vision model");
        return JNI_FALSE;
    }

    const char* mmprojChars = env->GetStringUTFChars(mmprojPath, nullptr);
    mtmd_context_params mparams = mtmd_context_params_default();
    mparams.n_threads = kInferenceThreads;
    // SmolVLM2's default preprocessing splits any decent-sized photo into a grid of
    // 384x384 tiles (observed: 6 tiles + 1 overview for a 1024x1024 input) and runs the
    // full vision encoder on each one separately (~9s/tile on this hardware — the
    // dominant cost of a photo description, not the text generation afterward).
    // Capping the token budget to one tile's worth forces the single-overview-tile path
    // instead, trading fine-grained detail for a ~4-5x speedup on the vision-encoding
    // step. 100 is comfortably above the ~81 tokens one tile produces so it doesn't
    // round down to something degenerate.
    mparams.image_max_tokens = 100;
    g_mtmd_ctx = mtmd_init_from_file(mmprojChars, g_vision_model, mparams);
    env->ReleaseStringUTFChars(mmprojPath, mmprojChars);
    if (g_mtmd_ctx == nullptr) {
        LOGE("Failed to load mmproj (vision encoder)");
        llama_model_free(g_vision_model);
        g_vision_model = nullptr;
        return JNI_FALSE;
    }

    LOGI("Vision model + mmproj loaded successfully");
    return JNI_TRUE;
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_nothing_voiceagent_localllm_LlamaBridge_describeImage(
    JNIEnv* env, jobject /*thiz*/, jstring imagePath, jstring prompt) {
    const char* imagePathChars = env->GetStringUTFChars(imagePath, nullptr);
    const char* promptChars = env->GetStringUTFChars(prompt, nullptr);
    std::string result = describeImageInternal(std::string(imagePathChars), std::string(promptChars));
    env->ReleaseStringUTFChars(imagePath, imagePathChars);
    env->ReleaseStringUTFChars(prompt, promptChars);
    return env->NewStringUTF(result.c_str());
}

extern "C" JNIEXPORT void JNICALL
Java_com_nothing_voiceagent_localllm_LlamaBridge_unloadVisionModel(JNIEnv* /*env*/, jobject /*thiz*/) {
    if (g_mtmd_ctx != nullptr) {
        mtmd_free(g_mtmd_ctx);
        g_mtmd_ctx = nullptr;
    }
    if (g_vision_model != nullptr) {
        llama_model_free(g_vision_model);
        g_vision_model = nullptr;
    }
}
