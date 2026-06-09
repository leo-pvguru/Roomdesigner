// Camera-driven projection helpers — supports orbit (yaw + pitch), top-down,
// and a first-person perspective walk-through mode.

export const FT = 14;

export interface Camera {
  yaw: number;
  pitch: number;
  // Walk-through: camera position in world coords. Only used when mode === 'walk'.
  eyeX?: number;
  eyeY?: number;
  eyeZ?: number;
  // Effective focal length in screen pixels. Only used when mode === 'walk'.
  focal?: number;
}

// Defaults — yaw=-45°, pitch=30° matches the original isometric look.
export const ISO: Camera = { yaw: -Math.PI / 4, pitch: Math.PI / 6 };
export const TOP: Camera = { yaw: 0, pitch: Math.PI / 2 };
export const FRONT: Camera = { yaw: 0, pitch: 0 };
export const SIDE: Camera = { yaw: -Math.PI / 2, pitch: 0 };

export type ViewMode = 'iso' | 'top' | 'walk';

function effectiveCamera(mode: ViewMode, camera?: Camera): Camera {
  if (mode === 'top') return TOP;
  return camera ?? ISO;
}

/** Marker used for points that fall behind the perspective near plane. */
export const BEHIND_CAMERA: [number, number] = [NaN, NaN];

/** Camera basis vectors derived from yaw+pitch. Forward is the look direction.
 *
 *  The right-axis here is computed as Up × Forward (left-handed for the
 *  walk projection). This matches the iso projection's screen-x convention
 *  so that switching between iso (orbit) and walk modes keeps objects on
 *  the same side of the screen — i.e. a speaker that's on the left in
 *  orbit stays on the left in first-person. A previous attempt to "fix"
 *  this to a right-handed convention made walk physically accurate but
 *  flipped left↔right relative to orbit, which broke the mode-switch UX.
 *  See git blame / project history for the rationale.
 */
function cameraBasis(c: Camera) {
  const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
  const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
  // Forward axis: yaw rotates around +Z, pitch tips up/down. yaw=0 looks +X,
  // yaw=π/2 looks +Y. Pitch positive looks up.
  const Fx = cy * cp;
  const Fy = sy * cp;
  const Fz = sp;
  // Right axis: horizontal, perpendicular to forward
  const Rx = -sy;
  const Ry = cy;
  const Rz = 0;
  // Up = Forward × Right — paired with the R convention above, gives +Z
  // when looking horizontally and tilts naturally with pitch.
  const Ux = Fy * Rz - Fz * Ry;
  const Uy = Fz * Rx - Fx * Rz;
  const Uz = Fx * Ry - Fy * Rx;
  return { Fx, Fy, Fz, Rx, Ry, Rz, Ux, Uy, Uz };
}

export function project(
  x: number, y: number, z: number,
  scale: number = FT,
  mode: ViewMode = 'iso',
  camera?: Camera,
): [number, number] {
  if (mode === 'top') {
    // Plan view: x→screen-x, y→screen-y. Z is dropped.
    return [x * scale, y * scale];
  }
  if (mode === 'walk') {
    const c = camera ?? ISO;
    const ex = c.eyeX ?? 0, ey = c.eyeY ?? 0, ez = c.eyeZ ?? 5.5;
    const focal = c.focal ?? 600;
    const { Fx, Fy, Fz, Rx, Ry, Ux, Uy, Uz } = cameraBasis(c);
    const Vx = x - ex, Vy = y - ey, Vz = z - ez;
    const xc = Vx * Rx + Vy * Ry;            // Rz is 0
    const yc = Vx * Ux + Vy * Uy + Vz * Uz;
    const zc = Vx * Fx + Vy * Fy + Vz * Fz;  // forward distance
    if (zc <= 0.05) return BEHIND_CAMERA;
    return [(xc / zc) * focal, -(yc / zc) * focal];
  }
  const c = effectiveCamera(mode, camera);
  const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
  const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
  const Xv = x * cy + y * sy;
  const Yv = -x * sy + y * cy;
  return [
    Xv * scale,
    -(Yv * sp + z * cp) * scale,
  ];
}

export function projectPoints(
  pts: [number, number, number][],
  scale: number,
  mode: ViewMode = 'iso',
  camera?: Camera,
): string {
  return pts.map(([x, y, z]) => project(x, y, z, scale, mode, camera).join(',')).join(' ');
}

// Depth-into-screen for z-sorting. Larger = farther from viewer.
export function viewDepth(
  x: number, y: number, z: number,
  mode: ViewMode = 'iso',
  camera?: Camera,
): number {
  if (mode === 'top') return -z; // looking straight down — high z is closer (smaller depth)
  if (mode === 'walk') {
    const c = camera ?? ISO;
    const ex = c.eyeX ?? 0, ey = c.eyeY ?? 0, ez = c.eyeZ ?? 5.5;
    const { Fx, Fy, Fz } = cameraBasis(c);
    return (x - ex) * Fx + (y - ey) * Fy + (z - ez) * Fz;
  }
  const c = effectiveCamera(mode, camera);
  const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
  const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
  const Yv = -x * sy + y * cy;
  return Yv * cp - z * sp;
}

// Inverse projection from a screen point (in the transformed group's coord frame
// — i.e. screen px minus offset) onto the world floor plane (z = 0).
// When sin(pitch) is near zero (front/side view), the floor is edge-on and this
// returns null — measurement isn't well-defined there.
export function unprojectToFloor(
  screenX: number, screenY: number,
  scale: number, offsetX: number, offsetY: number,
  mode: ViewMode = 'iso',
  camera?: Camera,
): { x: number; y: number } {
  if (mode === 'walk') {
    // Cast ray from camera through (screenX, screenY) and find z=0 intersection.
    const c = camera ?? ISO;
    const ex = c.eyeX ?? 0, ey = c.eyeY ?? 0, ez = c.eyeZ ?? 5.5;
    const focal = c.focal ?? 600;
    const sx = screenX - offsetX, sy = screenY - offsetY;
    const { Fx, Fy, Fz, Rx, Ry, Ux, Uy, Uz } = cameraBasis(c);
    // Ray direction in world space: focal * F + sx * R + (-sy) * U  (then normalize)
    const Dx = focal * Fx + sx * Rx + (-sy) * Ux;
    const Dy = focal * Fy + sx * Ry + (-sy) * Uy;
    const Dz = focal * Fz + (-sy) * Uz;
    if (Math.abs(Dz) < 1e-4) return { x: ex, y: ey }; // parallel to floor
    const t = -ez / Dz;
    return { x: ex + Dx * t, y: ey + Dy * t };
  }
  const sx = (screenX - offsetX) / scale;
  const sy = (screenY - offsetY) / scale;
  if (mode === 'top') return { x: sx, y: sy };
  const c = effectiveCamera(mode, camera);
  const sp = Math.sin(c.pitch);
  const cp = Math.cos(c.pitch);
  const Xv = sx;
  // screenY/scale = -(Yv * sin pitch + Z * cos pitch). For floor (Z=0):
  //   Yv = -sy / sin pitch
  // If sin pitch is very small (~ < 1°), bail out by treating as top.
  const Yv = Math.abs(sp) < 0.02 ? -sy : -sy / sp;
  // Inverse yaw: x = Xv cos α - Yv sin α; y = Xv sin α + Yv cos α
  const cy = Math.cos(c.yaw), sy2 = Math.sin(c.yaw);
  return {
    x: Xv * cy - Yv * sy2,
    y: Xv * sy2 + Yv * cy,
  };
}

export function fitProjection(
  corners: [number, number, number][],
  w: number, h: number,
  pad = 60,
  mode: ViewMode = 'iso',
  camera?: Camera,
) {
  if (mode === 'walk') {
    // Walk-through: identity scale; project() already returns screen-pixel coords
    // relative to the camera. Place the origin at canvas center.
    return { scale: 1, offsetX: w / 2, offsetY: h / 2 };
  }
  const projected = corners.map(c => project(c[0], c[1], c[2], 1, mode, camera));
  const xs = projected.map(p => p[0]);
  const ys = projected.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const sX = (w - pad * 2) / Math.max(1, maxX - minX);
  const sY = (h - pad * 2) / Math.max(1, maxY - minY);
  const scale = Math.min(sX, sY);
  const offsetX = -((minX + maxX) / 2) * scale + w / 2;
  const offsetY = -((minY + maxY) / 2) * scale + h / 2;
  return { scale, offsetX, offsetY };
}
