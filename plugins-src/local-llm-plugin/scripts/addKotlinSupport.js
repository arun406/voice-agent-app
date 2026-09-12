// Cordova `before_build` hook (registered in plugin.xml). `apply plugin: 'kotlin-android'`
// in lib/android/kotlin.gradle only works if the Kotlin Gradle plugin is on the
// buildscript classpath at the *root* project.build.gradle — that file isn't reachable
// from a plugin.xml <framework> gradleReference (those only patch the app module's
// build.gradle), so this hook edits the root file directly instead.
//
// Idempotent: checks for the classpath line before inserting, so re-running
// `cordova prepare` repeatedly doesn't duplicate it. Not yet run against a real
// generated project on this machine — verify the buildscript-block regex still matches
// once `cordova platform add android` has actually been run.

const fs = require('fs');
const path = require('path');

const KOTLIN_VERSION = '1.9.24';
const CLASSPATH_LINE = `        classpath "org.jetbrains.kotlin:kotlin-gradle-plugin:${KOTLIN_VERSION}"`;

module.exports = function (context) {
  const projectRoot = context.opts.projectRoot;
  const rootBuildGradle = path.join(projectRoot, 'platforms', 'android', 'build.gradle');

  if (!fs.existsSync(rootBuildGradle)) {
    console.warn(`[local-llm-plugin] ${rootBuildGradle} not found — skipping Kotlin classpath injection.`);
    return;
  }

  let contents = fs.readFileSync(rootBuildGradle, 'utf8');
  if (contents.includes('kotlin-gradle-plugin')) {
    return; // already patched
  }

  const buildscriptDepsMatch = contents.match(/buildscript\s*{[^}]*dependencies\s*{/);
  if (!buildscriptDepsMatch) {
    console.warn('[local-llm-plugin] Could not find buildscript { dependencies { ... } } block to patch — add the Kotlin classpath manually:');
    console.warn(`[local-llm-plugin]   ${CLASSPATH_LINE.trim()}`);
    return;
  }

  const insertAt = buildscriptDepsMatch.index + buildscriptDepsMatch[0].length;
  contents = contents.slice(0, insertAt) + '\n' + CLASSPATH_LINE + contents.slice(insertAt);
  fs.writeFileSync(rootBuildGradle, contents, 'utf8');
  console.log('[local-llm-plugin] Injected Kotlin Gradle plugin classpath into platforms/android/build.gradle');
};
