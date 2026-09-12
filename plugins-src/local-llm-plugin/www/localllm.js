var exec = require('cordova/exec');

/**
 * window.LocalLLM.chat(prompt) -> Promise<string>
 * Mirrors the API angular-app/src/app/services/local-llm.service.ts expects.
 */
module.exports = {
  chat: function (prompt) {
    return new Promise(function (resolve, reject) {
      exec(resolve, reject, 'LocalLLM', 'chat', [prompt]);
    });
  },

  /** Load (or reload) the model file. Call once at app startup. */
  loadModel: function (modelFileName) {
    return new Promise(function (resolve, reject) {
      exec(resolve, reject, 'LocalLLM', 'loadModel', [modelFileName]);
    });
  },

  /**
   * Describes a photo. imagePath is an absolute filesystem path (e.g. from
   * cordova-plugin-camera's FILE_URI destination type) — not a filesDir-relative
   * name like loadModel's argument. Loads the vision model on first call.
   */
  describeImage: function (imagePath, prompt) {
    return new Promise(function (resolve, reject) {
      exec(resolve, reject, 'LocalLLM', 'describeImage', [imagePath, prompt]);
    });
  }
};
