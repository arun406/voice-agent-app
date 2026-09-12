#!/usr/bin/env node
// cordova-android's generated theme hardcodes android:colorBackground to a pale
// default (#FAF8FF) in res/values/cdv_colors.xml, regenerated fresh on every
// `cordova prepare`. Neither the BackgroundColor preference (splash-screen only)
// nor a plain config-file merge (produces a duplicate-resource build error) can
// override it, so this hook rewrites the value directly after each prepare.
const fs = require('fs');
const path = require('path');

module.exports = function (context) {
  const colorsPath = path.join(
    context.opts.projectRoot,
    'platforms/android/app/src/main/res/values/cdv_colors.xml'
  );
  if (!fs.existsSync(colorsPath)) return;

  const original = fs.readFileSync(colorsPath, 'utf8');
  const patched = original.replace(
    /(<color name="cdv_background_color">)#[0-9A-Fa-f]{6,8}(<\/color>)/,
    '$1#FF05050A$2'
  );
  if (patched !== original) {
    fs.writeFileSync(colorsPath, patched, 'utf8');
  }

  // colorBackground alone doesn't change what's actually painted behind the window
  // (android:windowBackground does) — without it, the AppCompat default light
  // background still shows through in the edge-to-edge system-bar inset areas.
  // Also darken the nav bar to match, for the same reason at the bottom edge.
  const themesPath = path.join(
    context.opts.projectRoot,
    'platforms/android/app/src/main/res/values/cdv_themes.xml'
  );
  if (!fs.existsSync(themesPath)) return;

  const themesOriginal = fs.readFileSync(themesPath, 'utf8');
  let themesPatched = themesOriginal;
  if (!themesPatched.includes('android:windowBackground')) {
    themesPatched = themesPatched.replace(
      '<item name="android:colorBackground">@color/cdv_background_color</item>',
      '<item name="android:colorBackground">@color/cdv_background_color</item>\n' +
        '        <item name="android:windowBackground">@color/cdv_background_color</item>'
    );
  }
  if (!themesPatched.includes('android:navigationBarColor')) {
    themesPatched = themesPatched.replace(
      '<item name="android:statusBarColor">@android:color/transparent</item>',
      '<item name="android:statusBarColor">@android:color/transparent</item>\n' +
        '        <item name="android:navigationBarColor">@color/cdv_background_color</item>'
    );
  }
  // The WebView reserves its own extra top padding for the display cutout,
  // independent of (and in addition to) the top margin CordovaActivity already
  // applies for it — this shows up as an unpainted white strip exactly at the
  // WebView's own top edge. Telling the window to let content span shortEdges
  // stops Chromium from reserving that redundant inset.
  if (!themesPatched.includes('android:windowLayoutInDisplayCutoutMode')) {
    themesPatched = themesPatched.replace(
      '<item name="android:navigationBarColor">@color/cdv_background_color</item>',
      '<item name="android:navigationBarColor">@color/cdv_background_color</item>\n' +
        '        <item name="android:windowLayoutInDisplayCutoutMode">shortEdges</item>'
    );
  }
  if (themesPatched !== themesOriginal) {
    fs.writeFileSync(themesPath, themesPatched, 'utf8');
  }

  // Last resort: theme attributes (colorBackground/windowBackground) aren't
  // fixing a persistent white band at the WebView's top edge, so set the
  // window's background drawable directly in code, bypassing theme resolution
  // entirely.
  const mainActivityPath = path.join(
    context.opts.projectRoot,
    'platforms/android/app/src/main/java/com/nothing/voiceagent/MainActivity.java'
  );
  if (!fs.existsSync(mainActivityPath)) return;

  const mainActivityOriginal = fs.readFileSync(mainActivityPath, 'utf8');
  let mainActivityPatched = mainActivityOriginal;

  if (!mainActivityPatched.includes('setBackgroundDrawable')) {
    mainActivityPatched = mainActivityPatched
      .replace(
        'import android.os.Bundle;',
        'import android.os.Bundle;\nimport android.graphics.drawable.ColorDrawable;'
      )
      .replace(
        'super.onCreate(savedInstanceState);',
        'super.onCreate(savedInstanceState);\n\n' +
          '        getWindow().setBackgroundDrawable(new ColorDrawable(0xFF05050A));'
      );
  }

  if (!mainActivityPatched.includes('paintStatusBar')) {
    mainActivityPatched = mainActivityPatched
      .replace(
        'import android.os.Bundle;',
        'import android.os.Bundle;\nimport android.view.View;\nimport android.view.ViewGroup;'
      )
      .replace(
        '        // Set by <content src="index.html" /> in config.xml\n        loadUrl(launchUrl);',
        '        // Set by <content src="index.html" /> in config.xml\n' +
          '        loadUrl(launchUrl);\n\n' +
          '        // CordovaActivity adds a plain View (tagged "statusBarView") as the second\n' +
          '        // child of the WebView\'s parent, sized to the top system-bar inset. Its own\n' +
          '        // updateSystemBars() coloring (SystemBarPlugin) isn\'t sticking here for some\n' +
          '        // reason, leaving it visibly white — so find and color it ourselves directly,\n' +
          '        // once after the view tree is laid out and again on every resume in case\n' +
          '        // something resets it.\n' +
          '        final Runnable paintStatusBar = () -> {\n' +
          '            View webViewView = appView.getView();\n' +
          '            ViewGroup parent = (ViewGroup) webViewView.getParent();\n' +
          '            if (parent == null) return;\n' +
          '            for (int i = 0; i < parent.getChildCount(); i++) {\n' +
          '                View child = parent.getChildAt(i);\n' +
          '                if (child != webViewView) {\n' +
          '                    child.setBackgroundColor(0xFF05050A);\n' +
          '                }\n' +
          '            }\n' +
          '        };\n' +
          '        getWindow().getDecorView().post(paintStatusBar);\n' +
          '        getWindow().getDecorView().postDelayed(paintStatusBar, 300);'
      );
  }

  if (mainActivityPatched !== mainActivityOriginal) {
    fs.writeFileSync(mainActivityPath, mainActivityPatched, 'utf8');
  }
};
