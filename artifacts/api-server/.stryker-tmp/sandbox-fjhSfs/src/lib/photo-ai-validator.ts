// @ts-nocheck
import fs from "fs";
import { clog } from "./logger.js";
import path from "path";
import sharp from "sharp";

export type AIPhotoResult = {
  photoType: string;
  aiStatus: "ok" | "warning" | "fail";
  aiComment: string;
  checks: { name: string; passed: boolean; detail: string }[];
};

export type AIValidationResult = {
  overallStatus: "ok" | "warning" | "fail";
  photos: AIPhotoResult[];
};

function resolveFilePath(url: string): string {
  const filename = url.split("/").pop() || "";
  return path.resolve(process.cwd(), "artifacts", "uploads", "photo-control", filename);
}

let blazefaceModel: any = null;
let tf: any = null;
let blazefaceLoading: Promise<any> | null = null;

async function getBlazeFace() {
  if (blazefaceModel) return blazefaceModel;
  if (blazefaceLoading) return blazefaceLoading;

  blazefaceLoading = (async () => {
    try {
      tf = await import("@tensorflow/tfjs");
      const blazeface = await import("@tensorflow-models/blazeface");
      const model = await blazeface.load();
      blazefaceModel = model;
      clog.log("[AI VALIDATOR] BlazeFace model loaded");
      return model;
    } catch (err) {
      clog.error("[AI VALIDATOR] BlazeFace load failed:", err);
      throw err;
    } finally {
      blazefaceLoading = null;
    }
  })();

  return blazefaceLoading;
}

let ocrWorker: any = null;
let ocrLoading: Promise<any> | null = null;

async function getOCRWorker() {
  if (ocrWorker) return ocrWorker;
  if (ocrLoading) return ocrLoading;

  ocrLoading = (async () => {
    try {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng");
      ocrWorker = worker;
      clog.log("[AI VALIDATOR] Tesseract OCR worker ready");
      return worker;
    } catch (err) {
      clog.error("[AI VALIDATOR] Tesseract load failed:", err);
      throw err;
    } finally {
      ocrLoading = null;
    }
  })();

  return ocrLoading;
}

async function detectFaces(filePath: string): Promise<{ count: number; confidence: number; engineError: boolean }> {
  let tensor: any = null;
  try {
    const model = await getBlazeFace();
    const imgBuffer = await sharp(filePath)
      .resize(256, 256, { fit: "cover" })
      .removeAlpha()
      .raw()
      .toBuffer();

    tensor = tf.tensor3d(new Uint8Array(imgBuffer), [256, 256, 3]);
    const predictions = await model.estimateFaces(tensor, false);

    const validFaces = predictions.filter((p: any) => {
      const prob = Array.isArray(p.probability) ? p.probability[0] : p.probability;
      return prob > 0.7;
    });

    const maxConf = validFaces.length > 0
      ? Math.max(...validFaces.map((p: any) => {
          const prob = Array.isArray(p.probability) ? p.probability[0] : p.probability;
          return prob;
        }))
      : 0;

    return { count: validFaces.length, confidence: maxConf, engineError: false };
  } catch (err) {
    clog.error("[AI VALIDATOR] BlazeFace detection error:", err);
    return { count: 0, confidence: 0, engineError: true };
  } finally {
    if (tensor) {
      try { tensor.dispose(); } catch {}
    }
  }
}

async function extractPlateText(filePath: string): Promise<{ text: string; confidence: number; engineError: boolean }> {
  try {
    const worker = await getOCRWorker();
    const imgBuffer = await sharp(filePath)
      .resize(800, 600, { fit: "inside" })
      .sharpen()
      .greyscale()
      .normalise()
      .jpeg({ quality: 95 })
      .toBuffer();

    const result = await worker.recognize(imgBuffer);
    const rawText = result.data.text.trim();
    const plateChars = rawText.replace(/[^A-Za-z0-9А-Яа-яЁё]/g, "");
    return { text: plateChars, confidence: result.data.confidence, engineError: false };
  } catch (err) {
    clog.error("[AI VALIDATOR] Tesseract OCR error:", err);
    return { text: "", confidence: 0, engineError: true };
  }
}

async function analyzeImage(filePath: string): Promise<{
  width: number;
  height: number;
  size: number;
  brightness: number;
  contrast: number;
  sharpness: number;
  edgeDensity: number;
}> {
  const stat = fs.statSync(filePath);
  const metadata = await sharp(filePath).metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;

  const resized = await sharp(filePath)
    .resize(200, 200, { fit: "cover" })
    .removeAlpha()
    .raw()
    .toBuffer();

  const pixelCount = resized.length / 3;
  let rSum = 0, gSum = 0, bSum = 0;
  let rSqSum = 0, gSqSum = 0, bSqSum = 0;

  for (let i = 0; i < resized.length; i += 3) {
    const r = resized[i], g = resized[i + 1], b = resized[i + 2];
    rSum += r; gSum += g; bSum += b;
    rSqSum += r * r; gSqSum += g * g; bSqSum += b * b;
  }

  const rMean = rSum / pixelCount;
  const gMean = gSum / pixelCount;
  const bMean = bSum / pixelCount;
  const brightness = (rMean + gMean + bMean) / 3;
  const rVar = rSqSum / pixelCount - rMean * rMean;
  const gVar = gSqSum / pixelCount - gMean * gMean;
  const bVar = bSqSum / pixelCount - bMean * bMean;
  const contrast = Math.sqrt((rVar + gVar + bVar) / 3);

  const grey = await sharp(filePath)
    .resize(100, 100, { fit: "cover" })
    .greyscale()
    .raw()
    .toBuffer();

  let edgeSum = 0;
  const gw = 100;
  for (let y = 1; y < 99; y++) {
    for (let x = 1; x < 99; x++) {
      const idx = y * gw + x;
      const laplacian = Math.abs(
        grey[idx - 1] + grey[idx + 1] + grey[idx - gw] + grey[idx + gw] - 4 * grey[idx]
      );
      edgeSum += laplacian;
    }
  }
  const edgeDensity = edgeSum / (98 * 98);

  return { width, height, size: stat.size, brightness, contrast, sharpness: edgeDensity, edgeDensity };
}

async function validateSelfie(url: string): Promise<AIPhotoResult> {
  const filePath = resolveFilePath(url);
  const checks: { name: string; passed: boolean; detail: string }[] = [];

  try {
    const [analysis, faceResult] = await Promise.all([
      analyzeImage(filePath),
      detectFaces(filePath),
    ]);

    const resOk = analysis.width >= 300 && analysis.height >= 300;
    checks.push({
      name: "resolution",
      passed: resOk,
      detail: resOk
        ? `Разрешение ${analysis.width}x${analysis.height} — достаточное`
        : `Разрешение ${analysis.width}x${analysis.height} — слишком низкое (мин. 300x300)`,
    });

    if (faceResult.engineError) {
      checks.push({
        name: "face_detection",
        passed: false,
        detail: "Ошибка модели распознавания лиц — фото отправлено на ручную проверку",
      });
    } else {
      const hasFace = faceResult.count >= 1;
      checks.push({
        name: "face_detection",
        passed: hasFace,
        detail: hasFace
          ? `Обнаружено ${faceResult.count} лицо (уверенность ${(faceResult.confidence * 100).toFixed(0)}%)`
          : "Лицо не обнаружено (BlazeFace) — убедитесь что лицо хорошо видно на фото",
      });

      if (hasFace && faceResult.count > 1) {
        checks.push({
          name: "single_face",
          passed: false,
          detail: `Обнаружено ${faceResult.count} лица — на селфи должно быть только одно лицо`,
        });
      }
    }

    const notBlurry = analysis.sharpness > 3.0;
    checks.push({
      name: "blur_check",
      passed: notBlurry,
      detail: notBlurry
        ? `Фото четкое (резкость ${analysis.sharpness.toFixed(1)})`
        : `Фото размытое (резкость ${analysis.sharpness.toFixed(1)}) — сделайте четкий снимок`,
    });

    const brightOk = analysis.brightness > 40 && analysis.brightness < 230;
    checks.push({
      name: "brightness",
      passed: brightOk,
      detail: brightOk
        ? "Освещение нормальное"
        : analysis.brightness <= 40
          ? "Фото слишком тёмное — сделайте при хорошем освещении"
          : "Фото слишком яркое / засвеченное",
    });
  } catch (err) {
    checks.push({ name: "file_read", passed: false, detail: "Не удалось прочитать файл изображения" });
  }

  const failCount = checks.filter(c => !c.passed).length;
  const hasCriticalFail = checks.some(c => !c.passed && c.name === "face_detection" && !checks.find(cc => cc.name === "face_detection")?.detail.includes("Ошибка модели"));
  const hasEngineError = checks.some(c => c.name === "face_detection" && c.detail.includes("Ошибка модели"));
  const aiStatus: "ok" | "warning" | "fail" =
    hasCriticalFail || failCount >= 2 ? "fail"
    : hasEngineError || failCount === 1 ? "warning"
    : "ok";
  const aiComment = failCount === 0
    ? "Селфи соответствует требованиям"
    : hasCriticalFail
      ? "Лицо не обнаружено — сделайте фото лица крупным планом"
      : failCount === 1
        ? `Предупреждение: ${checks.find(c => !c.passed)?.detail}`
        : "Селфи не прошло проверку: " + checks.filter(c => !c.passed).map(c => c.detail).join("; ");

  return { photoType: "selfie", aiStatus, aiComment, checks };
}

async function validateCarFront(url: string): Promise<AIPhotoResult> {
  const filePath = resolveFilePath(url);
  const checks: { name: string; passed: boolean; detail: string }[] = [];

  try {
    const [analysis, plateResult] = await Promise.all([
      analyzeImage(filePath),
      extractPlateText(filePath),
    ]);

    const resOk = analysis.width >= 400 && analysis.height >= 300;
    checks.push({
      name: "resolution",
      passed: resOk,
      detail: resOk
        ? `Разрешение ${analysis.width}x${analysis.height} — достаточное`
        : `Разрешение ${analysis.width}x${analysis.height} — слишком низкое (мин. 400x300)`,
    });

    const brightOk = analysis.brightness > 35 && analysis.brightness < 235;
    checks.push({
      name: "brightness",
      passed: brightOk,
      detail: brightOk ? "Освещение достаточное" : "Плохое освещение — номер может быть не виден",
    });

    if (plateResult.engineError) {
      checks.push({
        name: "plate_ocr",
        passed: false,
        detail: "Ошибка OCR движка — фото отправлено на ручную проверку",
      });
    } else {
      const hasPlate = plateResult.text.length >= 3 && plateResult.confidence >= 20;
      checks.push({
        name: "plate_ocr",
        passed: hasPlate,
        detail: hasPlate
          ? `Номер распознан OCR: «${plateResult.text.substring(0, 20)}» (уверенность ${plateResult.confidence.toFixed(0)}%)`
          : plateResult.text.length > 0
            ? `Текст найден «${plateResult.text.substring(0, 15)}», но уверенность низкая (${plateResult.confidence.toFixed(0)}%) — переснимите чётче`
            : "Номерной знак не распознан (Tesseract OCR) — сфотографируйте автомобиль так, чтобы номер был виден",
      });
    }

    const hasDetail = analysis.edgeDensity > 2.5 && analysis.contrast > 25;
    checks.push({
      name: "detail_quality",
      passed: hasDetail,
      detail: hasDetail
        ? "Достаточно деталей на фото"
        : "Мало деталей — приблизьтесь к автомобилю",
    });

    const isLandscapeOrSquare = analysis.width >= analysis.height * 0.7;
    checks.push({
      name: "orientation",
      passed: isLandscapeOrSquare,
      detail: isLandscapeOrSquare
        ? "Ориентация корректная — автомобиль виден целиком"
        : "Снимите автомобиль горизонтально для полного обзора",
    });
  } catch (err) {
    checks.push({ name: "file_read", passed: false, detail: "Не удалось прочитать файл изображения" });
  }

  const failCount = checks.filter(c => !c.passed).length;
  const hasEngineError = checks.some(c => c.detail.includes("Ошибка OCR"));
  const hasCriticalFail = checks.some(c => !c.passed && c.name === "plate_ocr" && !hasEngineError);
  const aiStatus: "ok" | "warning" | "fail" =
    hasCriticalFail || failCount >= 2 ? "fail"
    : hasEngineError || failCount === 1 ? "warning"
    : "ok";
  const aiComment = failCount === 0
    ? "Фото авто спереди соответствует требованиям"
    : hasCriticalFail
      ? "Номерной знак не распознан — сфотографируйте авто так, чтобы передний номер был чётко виден"
      : failCount === 1
        ? `Предупреждение: ${checks.find(c => !c.passed)?.detail}`
        : "Фото авто спереди не прошло проверку: " + checks.filter(c => !c.passed).map(c => c.detail).join("; ");

  return { photoType: "car_front", aiStatus, aiComment, checks };
}

async function validateCarBack(url: string): Promise<AIPhotoResult> {
  const filePath = resolveFilePath(url);
  const checks: { name: string; passed: boolean; detail: string }[] = [];

  try {
    const [analysis, plateResult] = await Promise.all([
      analyzeImage(filePath),
      extractPlateText(filePath),
    ]);

    const resOk = analysis.width >= 400 && analysis.height >= 300;
    checks.push({
      name: "resolution",
      passed: resOk,
      detail: resOk
        ? `Разрешение ${analysis.width}x${analysis.height} — достаточное`
        : `Разрешение ${analysis.width}x${analysis.height} — слишком низкое`,
    });

    const brightOk = analysis.brightness > 35 && analysis.brightness < 235;
    checks.push({
      name: "brightness",
      passed: brightOk,
      detail: brightOk ? "Освещение достаточное" : "Плохое освещение — номер может быть не виден",
    });

    if (plateResult.engineError) {
      checks.push({
        name: "plate_ocr",
        passed: false,
        detail: "Ошибка OCR движка — фото отправлено на ручную проверку",
      });
    } else {
      const hasPlate = plateResult.text.length >= 3 && plateResult.confidence >= 20;
      checks.push({
        name: "plate_ocr",
        passed: hasPlate,
        detail: hasPlate
          ? `Задний номер распознан OCR: «${plateResult.text.substring(0, 20)}» (уверенность ${plateResult.confidence.toFixed(0)}%)`
          : plateResult.text.length > 0
            ? `Текст найден «${plateResult.text.substring(0, 15)}», но уверенность низкая (${plateResult.confidence.toFixed(0)}%) — переснимите чётче`
            : "Задний номерной знак не распознан (Tesseract OCR) — приблизьтесь и сфотографируйте номер чётко",
      });
    }

    const hasDetail = analysis.edgeDensity > 2.0 && analysis.contrast > 20;
    checks.push({
      name: "detail_quality",
      passed: hasDetail,
      detail: hasDetail ? "Достаточно деталей на фото" : "Мало деталей — увеличьте качество или приблизьтесь",
    });
  } catch (err) {
    checks.push({ name: "file_read", passed: false, detail: "Не удалось прочитать файл изображения" });
  }

  const failCount = checks.filter(c => !c.passed).length;
  const hasEngineError = checks.some(c => c.detail.includes("Ошибка OCR"));
  const hasCriticalFail = checks.some(c => !c.passed && c.name === "plate_ocr" && !hasEngineError);
  const aiStatus: "ok" | "warning" | "fail" =
    hasCriticalFail || failCount >= 2 ? "fail"
    : hasEngineError || failCount === 1 ? "warning"
    : "ok";
  const aiComment = failCount === 0
    ? "Фото авто сзади соответствует требованиям"
    : hasCriticalFail
      ? "Задний номерной знак не распознан — приблизьтесь и сфотографируйте номер чётко"
      : failCount === 1
        ? `Предупреждение: ${checks.find(c => !c.passed)?.detail}`
        : "Фото авто сзади не прошло проверку: " + checks.filter(c => !c.passed).map(c => c.detail).join("; ");

  return { photoType: "car_back", aiStatus, aiComment, checks };
}

async function validateInterior(url: string): Promise<AIPhotoResult> {
  const filePath = resolveFilePath(url);
  const checks: { name: string; passed: boolean; detail: string }[] = [];

  try {
    const [analysis, faceResult] = await Promise.all([
      analyzeImage(filePath),
      detectFaces(filePath),
    ]);

    const resOk = analysis.width >= 300 && analysis.height >= 200;
    checks.push({
      name: "resolution",
      passed: resOk,
      detail: resOk
        ? `Разрешение ${analysis.width}x${analysis.height} — достаточное`
        : "Разрешение слишком низкое",
    });

    const notDark = analysis.brightness > 30;
    checks.push({
      name: "not_dark",
      passed: notDark,
      detail: notDark
        ? `Освещение достаточное (яркость ${analysis.brightness.toFixed(0)})`
        : `Фото слишком тёмное (яркость ${analysis.brightness.toFixed(0)}) — включите свет в салоне`,
    });

    const hasContent = analysis.contrast > 15 && analysis.edgeDensity > 1.5;
    checks.push({
      name: "interior_visible",
      passed: hasContent,
      detail: hasContent ? "Салон виден на фото" : "Фото пустое или слишком однородное — покажите весь салон",
    });

    if (faceResult.engineError) {
      checks.push({
        name: "not_selfie",
        passed: false,
        detail: "Ошибка модели распознавания — невозможно проверить, что это не селфи. Отправлено на ручную проверку",
      });
    } else {
      const notSelfie = faceResult.count === 0;
      checks.push({
        name: "not_selfie",
        passed: notSelfie,
        detail: notSelfie
          ? "Фото салона (лицо не обнаружено — корректно)"
          : `Обнаружено лицо (BlazeFace) — это фото салона, а не селфи. Сфотографируйте интерьер автомобиля`,
      });
    }
  } catch (err) {
    checks.push({ name: "file_read", passed: false, detail: "Не удалось прочитать файл изображения" });
  }

  const failCount = checks.filter(c => !c.passed).length;
  const hasEngineError = checks.some(c => c.detail.includes("Ошибка модели"));
  const aiStatus: "ok" | "warning" | "fail" =
    failCount >= 2 ? "fail"
    : hasEngineError || failCount === 1 ? "warning"
    : "ok";
  const aiComment = failCount === 0
    ? "Фото салона соответствует требованиям"
    : failCount === 1
      ? `Предупреждение: ${checks.find(c => !c.passed)?.detail}`
      : "Фото салона не прошло проверку: " + checks.filter(c => !c.passed).map(c => c.detail).join("; ");

  return { photoType: "interior", aiStatus, aiComment, checks };
}

export async function validatePhotos(urls: {
  selfieUrl: string;
  carFrontUrl: string;
  carBackUrl: string;
  interiorUrl: string;
}): Promise<AIValidationResult> {
  const photos = await Promise.all([
    validateSelfie(urls.selfieUrl),
    validateCarFront(urls.carFrontUrl),
    validateCarBack(urls.carBackUrl),
    validateInterior(urls.interiorUrl),
  ]);

  const hasAnyFail = photos.some(p => p.aiStatus === "fail");
  const hasAnyWarning = photos.some(p => p.aiStatus === "warning");
  const overallStatus: "ok" | "warning" | "fail" = hasAnyFail ? "fail" : hasAnyWarning ? "warning" : "ok";

  return { overallStatus, photos };
}

export async function warmupModels(): Promise<void> {
  try {
    await Promise.all([getBlazeFace(), getOCRWorker()]);
    clog.log("[AI VALIDATOR] All models warmed up");
  } catch (err) {
    clog.error("[AI VALIDATOR] Model warmup failed:", err);
  }
}
