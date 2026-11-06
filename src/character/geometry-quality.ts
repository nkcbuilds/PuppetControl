/**
 * Conservative structural triage for Rev2D bust avatars.
 *
 * This catches suspicious landmarks that the upstream schema deliberately
 * allows. It never claims to measure pixel-level appearance or automatically
 * approve a rig; stylized or unusual bodies can require overriding a warning
 * after inspecting the generated review sheets.
 */
export interface AvatarGeometryWarning {
  code: string;
  path: string;
  message: string;
  severity: "warning";
}

function point(value: unknown): [number, number] | null {
  return Array.isArray(value) && value.length === 2 &&
    value.every((v) => typeof v === "number" && Number.isFinite(v))
    ? value as [number, number]
    : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function rectOfPolygon(value: unknown): {minX:number;maxX:number;minY:number;maxY:number}|null {
  if (!Array.isArray(value) || value.length < 8 || value.length % 2) return null;
  let minX = Infinity; let maxX = -Infinity;
  let minY = Infinity; let maxY = -Infinity;
  for (let i = 0; i < value.length; i += 2) {
    const x = value[i]; const y = value[i + 1];
    if (typeof x !== "number" || !Number.isFinite(x) ||
        typeof y !== "number" || !Number.isFinite(y)) return null;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return {minX,maxX,minY,maxY};
}

export function assessAvatarGeometry(spec: unknown): AvatarGeometryWarning[] {
  const avatar = record(spec);
  if (!avatar) return [];
  const head = record(avatar.head);
  const face = record(avatar.face);
  const body = record(avatar.body);
  const chest = record(body?.chest);
  const height = record(avatar.image)?.height;
  const warnings: AvatarGeometryWarning[] = [];
  const warn = (code: string, path: string, message: string) =>
    warnings.push({ code, path, message, severity: "warning" });

  const neck = point(head?.neck);
  const headPivot = point(head?.pivot);
  const bodyPivot = point(body?.pivot);
  const fade = point(body?.fade);
  const chestCenter = point(chest?.center);
  const chestRadius = point(chest?.radius);
  if (neck && headPivot && headPivot[1] > neck[1] + 3) {
    warn("HEAD_PIVOT_BELOW_NECK", "/head/pivot",
      "The head tilt pivot lies below the neck band: the neck can shear during turning.");
  }
  if (neck && bodyPivot && typeof height === "number" && Number.isFinite(height)) {
    const visibleTorso = height - neck[1];
    if (visibleTorso > 25 && bodyPivot[1] > neck[1] + visibleTorso * 0.72) {
      warn("BODY_PIVOT_TOO_LOW", "/body/pivot",
        "The body pivot is near the bottom of the canvas rather than the shoulder/upper torso: breathing and sway may look unnatural.");
    }
  }
  if (fade && chestCenter && chestRadius && chestRadius[1] > 0 &&
      fade[0] > chestCenter[1] + chestRadius[1] * 0.75) {
    warn("BODY_FADE_TOO_LOW", "/body/fade",
      "The body sway/fade begins well below the chest: upper-body motion may move the entire torso unnaturally.");
  }
  const eyeMap = record(face?.eyes);
  for (const side of ["imageLeft", "imageRight"]) {
    const eye = record(eyeMap?.[side]);
    const iris = record(eye?.iris);
    const irisCenter = point(iris?.center);
    const irisRadius = iris?.radius;
    if (!irisCenter || typeof irisRadius !== "number" ||
        !Number.isFinite(irisRadius) || irisRadius <= 0) {
      warn("IRIS_LANDMARK_MISSING", "/face/eyes/" + side + "/iris",
        "The eye lacks a usable iris center and scalar radius: gaze movement can be weak or incorrect.");
      continue;
    }
    const bounds = rectOfPolygon(eye?.opening);
    if (bounds && (irisCenter[0] < bounds.minX - 2 || irisCenter[0] > bounds.maxX + 2 ||
        irisCenter[1] < bounds.minY - 2 || irisCenter[1] > bounds.maxY + 2)) {
      warn("IRIS_OUTSIDE_EYE", "/face/eyes/" + side + "/iris/center",
        "The iris center is outside the eye opening and may disappear during gaze shifts.");
    }
    if (bounds && irisRadius > Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 0.7) {
      warn("IRIS_RADIUS_UNUSUAL", "/face/eyes/" + side + "/iris/radius",
        "Iris radius is unusually large relative to the eye opening; check whether an eye ellipse radius was mistaken for iris size.");
    }
  }
  return warnings;
}
