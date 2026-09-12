var exec = require('cordova/exec');

module.exports = {
  isDefaultAssistant: function () {
    return new Promise(function (resolve, reject) {
      exec(function (result) { resolve(!!result); }, reject, 'NativeAssist', 'isDefaultAssistant', []);
    });
  },

  openAssistantSettings: function () {
    return new Promise(function (resolve, reject) {
      exec(resolve, reject, 'NativeAssist', 'openAssistantSettings', []);
    });
  }
};
