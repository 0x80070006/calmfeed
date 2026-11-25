import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Signature release : lue depuis keystore.properties (ignoré par Git, jamais publié).
// Sans ce fichier, la build release reste non signée et seule la build debug est installable.
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

// Version de release : bundle.version (gradle.properties, ou -Pbundle.version=…).
// Injectée dans le manifeste (meta-data release.version), lue par la mise à jour intégrée.
val releaseVersion = (findProperty("bundle.version") as String?)?.trim().orEmpty().ifEmpty { "0.0.0" }
// versionCode croissant dérivé de la version : 0.7.0 → 7000, 1.2.3 → 1002003 (suffixe -beta ignoré).
val releaseCode = releaseVersion.substringBefore('-').split('.')
    .map { it.toIntOrNull() ?: 0 }.let { n -> n.getOrElse(0) { 0 } * 1_000_000 + n.getOrElse(1) { 0 } * 1_000 + n.getOrElse(2) { 0 } }
    .coerceAtLeast(1)

android {
    namespace = "app.calmfeed"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.calmfeed"
        minSdk = 26
        targetSdk = 36
        versionCode = releaseCode
        versionName = releaseVersion
        manifestPlaceholders["releaseVersion"] = releaseVersion
    }

    signingConfigs {
        if (keystoreProps.getProperty("storeFile") != null) {
            create("release") {
                storeFile = file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
}
