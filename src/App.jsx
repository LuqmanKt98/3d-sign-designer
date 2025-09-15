import React, {
  useRef,
  useState,
  useEffect,
  useMemo,
  useLayoutEffect,
  Suspense,
} from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import {
  Text3D,
  Environment,
  TransformControls,
  useTexture,
} from '@react-three/drei';
import {
  EffectComposer,
  Selection,
  SelectiveBloom,
} from '@react-three/postprocessing';
import * as THREE from 'three';

/* ───────────────────────────── Fonts ───────────────────────────── */

const FONT_OPTIONS = {
  Helvetiker:
    'https://unpkg.com/three@0.161.0/examples/fonts/helvetiker_regular.typeface.json',
  Helvetiker_Bold:
    'https://unpkg.com/three@0.161.0/examples/fonts/helvetiker_bold.typeface.json',
  Optimer:
    'https://unpkg.com/three@0.161.0/examples/fonts/optimer_regular.typeface.json',
  Optimer_Bold:
    'https://unpkg.com/three@0.161.0/examples/fonts/optimer_bold.typeface.json',
  Gentilis:
    'https://unpkg.com/three@0.161.0/examples/fonts/gentilis_regular.typeface.json',
  Gentilis_Bold:
    'https://unpkg.com/three@0.161.0/examples/fonts/gentilis_bold.typeface.json',
  DroidSans:
    'https://unpkg.com/three@0.161.0/examples/fonts/droid/droid_sans_regular.typeface.json',
  DroidSans_Bold:
    'https://unpkg.com/three@0.161.0/examples/fonts/droid/droid_sans_bold.typeface.json',
  DroidSerif:
    'https://unpkg.com/three@0.161.0/examples/fonts/droid/droid_serif_regular.typeface.json',
  DroidSerif_Bold:
    'https://unpkg.com/three@0.161.0/examples/fonts/droid/droid_serif_bold.typeface.json',
};

/* ───────────────────────────── Utils ───────────────────────────── */

const DEFAULT_TEXT = 'YOUR\nSIGN';
const rad = (d) => THREE.MathUtils.degToRad(d);
const deg = (r) => THREE.MathUtils.radToDeg(r);

function useObjectURL(file) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!file) return setUrl(null);
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return url;
}

function clampToBounds(pos, b) {
  if (!b) return;
  pos.x = Math.min(b.maxX, Math.max(b.minX, pos.x));
  pos.y = Math.min(b.maxY, Math.max(b.minY, pos.y));
}

/* ────────────────────────── History (Undo/Redo) ────────────────────────── */

function deepClone(v) {
  return JSON.parse(JSON.stringify(v));
}
function snapshotWithoutFiles(S) {
  const { file, logoFile, ...rest } = S;
  return deepClone(rest);
}

function useHistory(S, setS) {
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);
  const skipRef = useRef(false);

  useEffect(() => {
    if (skipRef.current) {
      skipRef.current = false;
      return;
    }
    const id = setTimeout(() => {
      setPast((p) => [...p, snapshotWithoutFiles(S)]);
      setFuture([]);
    }, 60);
    return () => clearTimeout(id);
  }, [S]);

  const apply = (snap) => {
    skipRef.current = true;
    setS((curr) => ({
      ...deepClone(snap),
      file: curr.file,
      logoFile: curr.logoFile,
    }));
  };

  const undo = () =>
    setPast((p) => {
      if (!p.length) return p;
      const prev = [...p];
      const snap = prev.pop();
      setFuture((f) => [snapshotWithoutFiles(S), ...f]);
      apply(snap);
      return prev;
    });
  const redo = () =>
    setFuture((f) => {
      if (!f.length) return f;
      const next = [...f];
      const snap = next.shift();
      setPast((p) => [...p, snapshotWithoutFiles(S)]);
      apply(snap);
      return next;
    });

  useEffect(() => {
    const onKey = (e) => {
      const z = e.key.toLowerCase() === 'z';
      const y = e.key.toLowerCase() === 'y';
      if ((e.metaKey || e.ctrlKey) && z && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.metaKey || e.ctrlKey) && (y || (z && e.shiftKey))) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [S]);

  return { undo, redo, canUndo: past.length > 0, canRedo: future.length > 0 };
}

/* ───────────────────────── Building Plane ───────────────────────── */

function BuildingPlane3D({
  imageURL,
  planeWidth = 120,
  tiltX = 0,
  tiltY = 0,
  z = -1,
}) {
  const tex = useTexture(imageURL);
  useEffect(() => {
    if (!tex) return;
    tex.anisotropy = 8;
    tex.colorSpace = THREE.SRGBColorSpace;
  }, [tex]);

  const [w, h] = useMemo(() => {
    const iw = tex?.image?.width || 1920;
    const ih = tex?.image?.height || 1080;
    const aspect = iw / ih;
    return [planeWidth, planeWidth / aspect];
  }, [tex, planeWidth]);

  return (
    <group position={[0, 0, z]} rotation={[rad(tiltX), rad(tiltY), 0]}>
      <mesh>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial map={tex} />
      </mesh>
    </group>
  );
}

/* ───────────────────────── Logo (always visible) ───────────────────────── */

function LogoGraphic({
  url,
  type, // 'svg' | 'raster'
  baseWidth = 2,
  depth = 0.15,
  transform, // { x, y, rot, scl }
  setTransform,
  bounds,
  gizmoMode,
  controlsEnabled,
  snapStep,
}) {
  const groupRef = useRef();

  useEffect(() => {
    const g = groupRef.current;
    if (!g) return;
    g.position.set(transform.x, transform.y, type === 'svg' ? 0.05 : 0.02);
    g.rotation.set(0, 0, transform.rot || 0);
    g.scale.set(transform.scl || 1, transform.scl || 1, transform.scl || 1);
  }, [transform.x, transform.y, transform.rot, transform.scl, type]);

  // Internal content (mesh) for both paths
  const Content = () => {
    if (type === 'svg') {
      const [geom, setGeom] = useState(null);
      useEffect(() => {
        let mounted = true;
        import('three/examples/jsm/loaders/SVGLoader').then(({ SVGLoader }) => {
          const loader = new SVGLoader();
          loader.load(url, (data) => {
            if (!mounted) return;
            const shapes = data.paths.flatMap((p) => p.toShapes(true));
            const g = new THREE.ExtrudeGeometry(shapes, {
              depth,
              bevelEnabled: false,
            });
            g.center();
            g.computeBoundingBox();
            const bb = g.boundingBox;
            const w = (bb?.max.x ?? 1) - (bb?.min.x ?? 0) || 1;
            const s = baseWidth / w;
            g.scale(s, s, s);
            setGeom(g);
          });
        });
        return () => {
          mounted = false;
        };
      }, [url, depth, baseWidth]);
      if (!geom) return null;
      return (
        <mesh geometry={geom}>
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      );
    } else {
      const texture = useTexture(url);
      useEffect(() => {
        if (texture) {
          texture.anisotropy = 8;
          texture.colorSpace = THREE.SRGBColorSpace;
        }
      }, [texture]);
      const aspect = useMemo(() => {
        const w = texture.image?.width || 1;
        const h = texture.image?.height || 1;
        return w / h;
      }, [texture]);
      return (
        <mesh>
          <planeGeometry args={[baseWidth, baseWidth / aspect]} />
          <meshBasicMaterial map={texture} transparent />
        </mesh>
      );
    }
  };

  const Inner = (
    <group ref={groupRef} onPointerDown={(e) => e.stopPropagation()}>
      <Content />
    </group>
  );

  if (!controlsEnabled) return Inner;

  return (
    <TransformControls
      mode={gizmoMode}
      showX
      showY
      showZ={false}
      onObjectChange={() => {
        const g = groupRef.current;
        if (!g) return;
        clampToBounds(g.position, bounds);
        if (snapStep && gizmoMode === 'translate') {
          g.position.x = Math.round(g.position.x / snapStep) * snapStep;
          g.position.y = Math.round(g.position.y / snapStep) * snapStep;
        }
        setTransform({
          x: g.position.x,
          y: g.position.y,
          rot: g.rotation.z,
          scl: g.scale.x,
        });
      }}
    >
      {Inner}
    </TransformControls>
  );
}

/* ───────────────────── Channel Letters + Panel ───────────────────── */

function ChannelLettersAndPanel({
  signType,
  showLetters,
  text,
  fontUrl,
  depth,
  size,
  faceColor,
  trimColor,
  showRaceway,
  racewayColor,
  racewayHeightUnits,
  racewayPadUnits,
  racewayYOffsetUnits = 0,
  racewayZOrder = 'behind',
  lineSpacing,
  perLineRaceway,
  perLinePadUnits,
  perLineHeightUnits,
  perLineWidthScale,
  showPanel,
  panelColor,
  panelDepth,
  panelPadX = 6,
  panelPadY = 6,
  textOnlyRef,
  enableLineSizers,
  activeLineIndex,
  linePoses,
  onLinePoseChange,
  transformMode,
  boundsForLines,
  snapEnabled,
  snapStep,
  snapAngleDeg,
  activeTool,
  onClickLine,
}) {
  const lines = (text || DEFAULT_TEXT).split('\n').map((s) => s.trimEnd());
  const step = size * (lineSpacing || 1.1);
  const firstY = ((lines.length - 1) * step) / 2;

  const textMeshRefs = useRef([]);
  const [lineLocalWidths, setLineLocalWidths] = useState([]);

  useLayoutEffect(() => {
    (textMeshRefs.current || []).forEach((mesh) => {
      if (!mesh?.geometry) return;
      mesh.geometry.computeBoundingBox?.();
      //mesh.geometry.center?.(); // always re-center text
    });
    const widths = (textMeshRefs.current || []).map((mesh) => {
      if (!mesh?.geometry) return 0;
      mesh.geometry.computeBoundingBox();
      const bb = mesh.geometry.boundingBox;
      return Math.max(0.001, bb.max.x - bb.min.x);
    });
    setLineLocalWidths(widths);
  }, [text, size, lineSpacing, fontUrl, perLineWidthScale, linePoses]);

  const HiddenTextOnly = () => (
    <group ref={textOnlyRef} visible={false}>
      {lines.map((line, i) => {
        const y = firstY - i * step;
        return (
          <group key={`hidden-${i}`} position={[0, y, 0]}>
            <Text3D
              font={fontUrl}
              size={size}
              height={depth}
              bevelEnabled
              bevelSize={Math.min(0.02 * size, 2)}
              bevelThickness={Math.min(0.02 * depth, 1)}
              curveSegments={8}
              onUpdate={(self) => {
                self.geometry.computeBoundingBox();
                const box = self.geometry.boundingBox;
                if (box) {
                  const centerX = (box.max.x + box.min.x) / 2;
                  const centerY = (box.max.y + box.min.y) / 2;
                  const centerZ = (box.max.z + box.min.z) / 2;
                  self.geometry.translate(-centerX, -centerY, -centerZ);
                }
              }}
            >
              {line}
              <meshBasicMaterial attach="material-0" color={faceColor} />
              <meshBasicMaterial attach="material-1" color={trimColor} />
            </Text3D>
          </group>
        );
      })}
    </group>
  );

  const racewayDepth = Math.max(depth * 0.4, 0.5);
  const clearance = Math.max(0.5, 0.02 * size);
  const racewayZ =
    racewayZOrder === 'front'
      ? depth * 0.5 + racewayDepth * 0.5 + clearance
      : -(depth * 0.5 + racewayDepth * 0.5 + clearance);

  const [panelDims, setPanelDims] = useState({ w: 4, h: 2 });
  useLayoutEffect(() => {
    const grp = textOnlyRef?.current;
    if (!grp) return;
    const box = new THREE.Box3().setFromObject(grp);
    const w = Math.max(0.001, box.max.x - box.min.x);
    const h = Math.max(0.001, box.max.y - box.min.y);
    setPanelDims({ w: w + panelPadX * 2, h: h + panelPadY * 2 });
  }, [text, size, lineSpacing, panelPadX, panelPadY, perLineWidthScale]);

  const onPoseChange = (i, g, defaultY) => {
    onLinePoseChange?.(i, {
      x: g.position.x,
      y: g.position.y,
      rot: g.rotation.z,
      scale: g.scale.x,
      _defaultY: defaultY,
      _baseline: step,
    });
  };

  const applySnapToGroup = (g) => {
    if (!snapEnabled || !g) return;
    g.position.x = Math.round(g.position.x / snapStep) * snapStep;
    g.position.y = Math.round(g.position.y / snapStep) * snapStep;
    const d = deg(g.rotation.z || 0);
    const snappedDeg = Math.round(d / snapAngleDeg) * snapAngleDeg;
    g.rotation.z = rad(snappedDeg);
    const s = g.scale?.x ?? 1;
    const snappedS = Math.max(0.2, Math.round(s / 0.05) * 0.05);
    g.scale.set(snappedS, snappedS, snappedS);
  };

  return (
    <group>
      <HiddenTextOnly />

      {signType === 'pan' && showPanel && (
        <mesh position={[0, 0, -(panelDepth / 2) - 0.1]}>
          <boxGeometry
            args={[
              Math.max(panelDims.w, size * 2),
              Math.max(panelDims.h, size * 1.2),
              panelDepth,
            ]}
          />
          <meshBasicMaterial color={panelColor} />
        </mesh>
      )}

      {lines.map((line, i) => {
        const defaultY = firstY - i * step;
        const widthScale = perLineWidthScale?.[i] ?? 1;

        const pose = linePoses?.[i] ?? {
          x: 0,
          y: defaultY,
          rot: 0,
          scale: 1,
          _defaultY: defaultY,
          _baseline: step,
        };
        const appliedY =
          pose._baseline === step
            ? pose.y
            : pose.y + (defaultY - (pose._defaultY ?? defaultY));

        const groupProps = {
          position: [pose.x || 0, appliedY, 0],
          rotation: [0, 0, pose.rot || 0],
          scale: [pose.scale || 1, pose.scale || 1, pose.scale || 1],
          onPointerDown: (e) => {
            e.stopPropagation();
            onClickLine?.(i);
          },
        };

        const baseWidth = lineLocalWidths[i] || size * 4;
        const effectiveTextWidth = baseWidth * widthScale * (pose.scale || 1);
        const rwPad = (perLinePadUnits?.[i] ?? racewayPadUnits ?? 0) * 2;
        const rwWidth = Math.max(effectiveTextWidth + rwPad, size * 2);
        const rwHeight = Math.max(
          perLineHeightUnits?.[i] ?? racewayHeightUnits ?? size * 0.35,
          size * 0.12
        );

        const WidthScaled = (
          <group scale={[widthScale, 1, 1]}>
            {showRaceway && perLineRaceway && (
              <mesh position={[0, racewayYOffsetUnits, racewayZ]}>
                <boxGeometry
                  args={[
                    rwWidth / (pose.scale || 1),
                    rwHeight,
                    Math.max(racewayDepth, 0.2),
                  ]}
                />
                <meshBasicMaterial color={racewayColor} />
              </mesh>
            )}

            {showLetters && (
              <Text3D
                ref={(el) => (textMeshRefs.current[i] = el)}
                font={fontUrl}
                size={size}
                height={depth}
                bevelEnabled
                bevelSize={Math.min(0.02 * size, 2)}
                bevelThickness={Math.min(0.02 * depth, 1)}
                curveSegments={8}
                onUpdate={(self) => {
                  self.geometry.computeBoundingBox();
                  const box = self.geometry.boundingBox;
                  if (box) {
                    const centerX = (box.max.x + box.min.x) / 2;
                    const centerY = (box.max.y + box.min.y) / 2;
                    const centerZ = (box.max.z + box.min.z) / 2;
                    self.geometry.translate(-centerX, -centerY, -centerZ);
                  }
                }}
              >
                {line}
                <meshBasicMaterial attach="material-0" color={faceColor} />
                <meshBasicMaterial attach="material-1" color={trimColor} />
              </Text3D>
            )}
          </group>
        );

        if (!enableLineSizers || activeTool !== 'lines') {
          return (
            <group key={`row-${i}`} {...groupProps}>
              {WidthScaled}
            </group>
          );
        }

        return (
          <TransformControls
            key={`row-${i}`}
            enabled={i === activeLineIndex}
            mode={transformMode}
            showX
            showY
            showZ={false}
            size={0.9}
            onObjectChange={(e) => {
              const g = e?.target?.object || e?.target;
              if (!g?.position) return;
              g.position.z = 0;
              if (snapEnabled) applySnapToGroup(g);
              clampToBounds(g.position, boundsForLines);
              onPoseChange(i, g, defaultY);
            }}
          >
            <group {...groupProps}>{WidthScaled}</group>
          </TransformControls>
        );
      })}
    </group>
  );
}

/* ───────────────────────── Halo (locked + proper spread) ───────────────────────── */

function HaloOnly({
  text,
  fontUrl,
  depth,
  size,
  lineSpacing,
  perLineWidthScale,
  haloColor,
  haloStrength,
  glowSize,
  bloomRadius,
  haloOffsetX,
  haloOffsetY,
  linePoses,
}) {
  // Build halo using the **same** transform nesting as text:
  // pose (x,y,rot,scale) -> widthScale -> halo backplate
  const haloColor3 = useMemo(
    () => new THREE.Color(haloColor || '#ffffff'),
    [haloColor]
  );
  const lines = (text || DEFAULT_TEXT).split('\n').map((s) => s.trimEnd());
  const step = size * (lineSpacing || 1.1);
  const firstY = ((lines.length - 1) * step) / 2;

  const defaultZ = -(depth * 1.15); // small constant offset behind face
  const haloScaleBase = 1.02 + Math.min(0.5, glowSize); // only controls backplate size

  const poseFor = (i, defaultY) => {
    const p = linePoses?.[i] ?? {
      x: 0,
      y: defaultY,
      rot: 0,
      scale: 1,
      _defaultY: defaultY,
      _baseline: step,
    };
    const y =
      p._baseline === step ? p.y : p.y + (defaultY - (p._defaultY ?? defaultY));
    return { x: p.x || 0, y, rot: p.rot || 0, scl: p.scale || 1 };
  };

  return (
    <Selection enabled>
      {lines.map((line, i) => {
        const defaultY = firstY - i * step;
        const pose = poseFor(i, defaultY);
        const widthScale = perLineWidthScale?.[i] ?? 1;

        return (
          <group
            key={`halo-${i}`}
            position={[pose.x, pose.y, 0]}
            rotation={[0, 0, pose.rot]}
            scale={[pose.scl, pose.scl, pose.scl]}
          >
            <group scale={[widthScale, 1, 1]}>
              <group
                position={[haloOffsetX, haloOffsetY, defaultZ]}
                scale={[haloScaleBase, haloScaleBase, 1]}
              >
                <Text3D
                  font={fontUrl}
                  size={size}
                  height={depth}
                  bevelEnabled
                  bevelSize={Math.min(0.02 * size, 2)}
                  bevelThickness={Math.min(0.02 * depth, 1)}
                  curveSegments={8}
                  onUpdate={(self) => {
                    self.geometry.computeBoundingBox();
                    const box = self.geometry.boundingBox;
                    if (box) {
                      const centerX = (box.max.x + box.min.x) / 2;
                      const centerY = (box.max.y + box.min.y) / 2;
                      const centerZ = (box.max.z + box.min.z) / 2;
                      self.geometry.translate(-centerX, -centerY, -centerZ);
                    }
                  }}
                >
                  {line}
                  <meshStandardMaterial
                    color={haloColor3}
                    emissive={haloColor3}
                    emissiveIntensity={haloStrength}
                    roughness={1}
                    metalness={0}
                    toneMapped={false}
                  />
                </Text3D>
              </group>
            </group>
          </group>
        );
      })}

      <EffectComposer disableNormalPass>
        <SelectiveBloom
          intensity={1}
          radius={bloomRadius} // ← true spread
          luminanceThreshold={0.0}
          luminanceSmoothing={0.02}
          mipmapBlur
        />
      </EffectComposer>
    </Selection>
  );
}

/* ───────────────────────── 4-Point Fit (Plane Snap) ───────────────────────── */

function orderQuad(points) {
  const pts = points.slice();
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  pts.sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)
  );
  let start = 0,
    best = Infinity;
  pts.forEach((p, i) => {
    const v = p.x + p.y;
    if (v < best) {
      best = v;
      start = i;
    }
  });
  return [
    pts[start],
    pts[(start + 1) % 4],
    pts[(start + 2) % 4],
    pts[(start + 3) % 4],
  ];
}
function solveAffine(from, to) {
  const A = [],
    B = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: X, y: Y } = to[i];
    A.push([x, y, 1, 0, 0, 0]);
    B.push(X);
    A.push([0, 0, 0, x, y, 1]);
    B.push(Y);
  }
  const AT = (m) => m[0].map((_, j) => m.map((r) => r[j]));
  const mul = (m, n) =>
    m.map((r) => n[0].map((_, j) => r.reduce((s, v, k) => s + v * n[k][j], 0)));
  const inv = (m) => {
    const n = m.length,
      a = m.map((r, i) => [
        ...r,
        ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
      ]);
    for (let c = 0; c < n; c++) {
      let r = c;
      for (let i = c + 1; i < n; i++)
        if (Math.abs(a[i][c]) > Math.abs(a[r][c])) r = i;
      [a[c], a[r]] = [a[r], a[c]];
      const d = a[c][c] || 1e-9;
      for (let j = 0; j < 2 * n; j++) a[c][j] /= d;
      for (let i = 0; i < n; i++)
        if (i !== c) {
          const f = a[i][c];
          for (let j = 0; j < 2 * n; j++) a[i][j] -= f * a[c][j];
        }
    }
    return a.map((r) => r.slice(n));
  };
  const ATm = AT(A);
  const ATAi = inv(mul(ATm, A));
  const X = mul(
    ATAi,
    mul(
      ATm,
      B.map((v) => [v])
    )
  ).map((r) => r[0]);
  const [a, b, c, d, e, f] = X;
  return { a, b, c, d, e, f };
}
function decomposeAffineToTRS({ a, b, c, d, e, f }) {
  const position = new THREE.Vector3(c, f, 0);
  const sx = Math.hypot(a, d),
    sy = Math.hypot(b, e);
  const rotationZ = Math.atan2(d, a);
  return { position, rotationZ, scale: new THREE.Vector3(sx, sy, 1) };
}

function FourPointFitOverlay({
  enabled,
  size,
  onPointsChange,
  points,
  onApply,
  onCancel,
}) {
  if (!enabled) return null;
  const addPoint = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    onPointsChange(
      [
        ...(points || []),
        { x: e.clientX - rect.left, y: e.clientY - rect.top },
      ].slice(0, 4)
    );
  };
  return (
    <div
      className="absolute inset-0 z-[6] cursor-crosshair"
      style={{ width: size.w, height: size.h }}
      onClick={addPoint}
    >
      <div className="absolute inset-0 bg-black/20 pointer-events-none" />
      <svg
        className="absolute inset-0 pointer-events-none"
        width={size.w}
        height={size.h}
      >
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="5" fill="white" />
            <text x={p.x + 8} y={p.y - 8} fill="white" fontSize="12">
              {i + 1}
            </text>
          </g>
        ))}
        {points.length >= 2 &&
          points.map((p, i) => {
            const q = points[(i + 1) % points.length];
            return i < points.length - 1 ? (
              <line
                key={`l${i}`}
                x1={p.x}
                y1={p.y}
                x2={q.x}
                y2={q.y}
                stroke="white"
                strokeWidth="2"
              />
            ) : null;
          })}
      </svg>
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-2">
        <button
          onClick={onApply}
          className="px-3 py-2 rounded bg-blue-600 text-white shadow"
          disabled={points.length !== 4}
        >
          Apply Fit
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-2 rounded bg-neutral-800 border border-neutral-600"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ───────────────────────── Nudge Pad ───────────────────────── */

function NudgePad({ label, onNudge, step, setStep }) {
  return (
    <div className="border border-neutral-800 rounded-lg p-3 space-y-2">
      <div className="text-sm font-medium">{label}</div>
      <div className="flex gap-2 items-center">
        <span className="text-xs opacity-70">Step</span>
        <input
          type="number"
          step="0.1"
          min="0.05"
          className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1 w-20"
          value={step}
          onChange={(e) =>
            setStep(Math.max(0.05, Number(e.target.value) || 0.05))
          }
        />
      </div>
      <div className="grid grid-cols-3 gap-2 w-[160px]">
        <div />
        <button
          onClick={() => onNudge(0, step)}
          className="p-2 rounded bg-neutral-800 border border-neutral-700"
        >
          ↑
        </button>
        <div />
        <button
          onClick={() => onNudge(-step, 0)}
          className="p-2 rounded bg-neutral-800 border border-neutral-700"
        >
          ←
        </button>
        <button
          onClick={() => onNudge(0, 0)}
          className="p-2 rounded bg-neutral-800 border border-neutral-700"
        >
          •
        </button>
        <button
          onClick={() => onNudge(step, 0)}
          className="p-2 rounded bg-neutral-800 border border-neutral-700"
        >
          →
        </button>
        <div />
        <button
          onClick={() => onNudge(0, -step)}
          className="p-2 rounded bg-neutral-800 border border-neutral-700"
        >
          ↓
        </button>
        <div />
      </div>
    </div>
  );
}

/* ───────────────────────────── App ───────────────────────────── */

export default function App() {
  const [S, setS] = useState(() => ({
    file: null,
    imgW: 1600,
    imgH: 900,
    signTX: 0,
    signTY: 0,
    signRZ: 0,
    signScale: 1,
    activeTool: 'lines',
    signType: 'pan',
    showLettersOnPan: false,
    text: DEFAULT_TEXT,
    fontUrl: FONT_OPTIONS.Helvetiker,
    style: 'front',
    size: 32,
    lineSpacing: 1.1,
    faceColor: '#ffffff',
    trimColor: '#222222',
    haloStrength: 1.8,
    haloColor: '#ffffff',
    glowSize: 0.08, // NEW: size of halo backplate (0…0.5)
    bloomRadius: 0.6, // NEW: true glow spread
    haloOffsetX: 0,
    haloOffsetY: 0,
    timeOfDay: 0,
    showRaceway: false,
    racewayColor: '#222222',
    racewayHeightUnits: 32 * 0.35,
    racewayPadUnits: 6,
    racewayYOffsetUnits: 0,
    racewayZOrder: 'behind',
    perLineRaceway: true,
    perLinePadUnits: [],
    perLineHeightUnits: [],
    perLineWidthScale: [],
    showPanel: true,
    panelColor: '#cfcfcf',
    panelDepth: 0.2,
    panelPadX: 6,
    panelPadY: 6,
    bldTiltX: 0,
    bldTiltY: 0,
    enableLineSizers: true,
    activeLineIndex: 0,
    transformMode: 'translate',
    linePoses: [],
    snapEnabled: true,
    snapStep: 0.5,
    snapAngleDeg: 5,
    logoFile: null,
    logoBaseWidth: 12,
    logoTransform: { x: 0, y: 0, rot: 0, scl: 1 },
    logoGizmoMode: 'translate',
    fitPoints: [],
    fitMode: false,
  }));

  const set = (patch) => setS((prev) => ({ ...prev, ...patch }));
  const imgURL = useObjectURL(S.file);
  const logoURL = useObjectURL(S.logoFile);
  const { undo, redo, canUndo, canRedo } = useHistory(S, setS);

  useEffect(() => {
    if (!imgURL) return;
    const i = new Image();
    i.onload = () => set({ imgW: i.naturalWidth, imgH: i.naturalHeight });
    i.src = imgURL;
  }, [imgURL]);

  const ambientI = THREE.MathUtils.lerp(0.35, 0.06, S.timeOfDay);
  const dirI = THREE.MathUtils.lerp(0.75, 0.22, S.timeOfDay);
  const overlayAlpha = THREE.MathUtils.lerp(0.0, 0.65, S.timeOfDay);
  const envPreset = S.timeOfDay > 0.6 ? 'night' : 'sunset';

  const uiLines = useMemo(
    () => (S.text || DEFAULT_TEXT).split('\n').map((s) => s.trimEnd()),
    [S.text]
  );
  useEffect(() => {
    const n = uiLines.length;
    set((prev) => {
      const plp = Array.from(
        { length: n },
        (_, i) => prev.perLinePadUnits[i] ?? prev.racewayPadUnits ?? 0
      );
      const plh = Array.from(
        { length: n },
        (_, i) => prev.perLineHeightUnits[i] ?? prev.size * 0.35
      );
      const plw = Array.from(
        { length: n },
        (_, i) => prev.perLineWidthScale[i] ?? 1
      );
      return {
        perLinePadUnits: plp,
        perLineHeightUnits: plh,
        perLineWidthScale: plw,
      };
    });
  }, [uiLines.length, S.racewayPadUnits, S.size]);

  useEffect(() => {
    const n = uiLines.length;
    const stepLocal = S.size * (S.lineSpacing || 1.1);
    const firstYLocal = ((n - 1) * stepLocal) / 2;

    set((prev) => {
      const next = Array.from({ length: n }, (_, i) => {
        const defaultY = firstYLocal - i * stepLocal;
        const p = prev.linePoses[i];
        if (!p)
          return {
            x: 0,
            y: defaultY,
            rot: 0,
            scale: 1,
            _defaultY: defaultY,
            _baseline: stepLocal,
          };
        if (
          typeof p._baseline === 'number' &&
          typeof p._defaultY === 'number'
        ) {
          const oldB = p._baseline;
          const oldFirstY = ((n - 1) * oldB) / 2;
          const oldIdx = Math.round((oldFirstY - p._defaultY) / oldB);
          const newDefault = firstYLocal - oldIdx * stepLocal;
          const userOffset = p.y - p._defaultY;
          return {
            ...p,
            y: newDefault + userOffset,
            _defaultY: newDefault,
            _baseline: stepLocal,
          };
        }
        return { ...p, y: defaultY, _defaultY: defaultY, _baseline: stepLocal };
      });
      return { linePoses: next };
    });
  }, [uiLines.length, S.size, S.lineSpacing]);

  const maxW = Math.min(
    1400,
    typeof window !== 'undefined' ? window.innerWidth * 0.75 : 1000
  );
  const dispW = Math.max(640, Math.min(maxW, S.imgW));
  const dispH = S.imgH * (dispW / S.imgW);

  const textOnlyRef = useRef();

  const getTextOnlyWorldSize = () => {
    const grp = textOnlyRef.current;
    if (!grp) return { w: 1, h: 1 };
    const box = new THREE.Box3().setFromObject(grp);
    return {
      w: Math.max(0.001, box.max.x - box.min.x),
      h: Math.max(0.001, box.max.y - box.min.y),
    };
  };

  const lettersBounds = useMemo(() => {
    const { w, h } = getTextOnlyWorldSize();
    const padLocal = S.size * 0.8;
    const localW = w + 2 * padLocal;
    const localH = h + 2 * padLocal * 0.6;
    const m = 0.4;
    return {
      minX: -localW / 2 + m,
      maxX: localW / 2 - m,
      minY: -localH / 2 + m,
      maxY: localH / 2 - m,
      width: localW,
      height: localH,
    };
  }, [S.text, S.size, S.lineSpacing, S.perLineWidthScale]);

  const panelBounds = useMemo(() => {
    const { w: textW, h: textH } = getTextOnlyWorldSize();
    const scl = S.signScale || 1;
    const panelWorldW = textW + 2 * S.panelPadX * scl;
    const panelWorldH = textH + 2 * S.panelPadY * scl;
    const localW = panelWorldW / scl;
    const localH = panelWorldH / scl;
    const m = 0.4;
    return {
      minX: -localW / 2 + m,
      maxX: localW / 2 - m,
      minY: -localH / 2 + m,
      maxY: localH / 2 - m,
      width: localW,
      height: localH,
    };
  }, [
    S.text,
    S.size,
    S.lineSpacing,
    S.panelPadX,
    S.panelPadY,
    S.perLineWidthScale,
    S.signScale,
  ]);

  const lettersVisible =
    S.signType === 'letters' || (S.signType === 'pan' && S.showLettersOnPan);

  const logoDefaultWidth = useMemo(() => {
    const containerW =
      S.signType === 'pan' ? panelBounds?.width : lettersBounds?.width;
    return Math.max(0.5, (containerW || S.size * 4) * 0.6);
  }, [S.signType, panelBounds.width, lettersBounds.width, S.size]);

  useEffect(() => {
    if (!S.logoBaseWidth && logoDefaultWidth)
      set({ logoBaseWidth: logoDefaultWidth });
  }, [logoDefaultWidth]);

  const applyFourPointFit = () => {
    if (S.fitPoints.length !== 4) return;
    const [tl, tr, br, bl] = orderQuad(S.fitPoints);

    const { w, h } = getTextOnlyWorldSize();
    const pad = S.size * 0.5;
    const W = (w || 1) + pad * 2;
    const H = (h || 1) + pad * 2;
    const src = [
      { x: -W / 2, y: -H / 2 },
      { x: +W / 2, y: -H / 2 },
      { x: +W / 2, y: +H / 2 },
      { x: -W / 2, y: +H / 2 },
    ];

    const screenToWorld = (pt) => {
      const planeW = 120;
      const sx = (pt.x / dispW) * planeW - planeW / 2;
      const planeH = planeW * (S.imgH / S.imgW);
      const sy = -(pt.y / dispH) * planeH + planeH / 2;
      return { x: sx, y: sy };
    };

    const tgt = [tl, tr, br, bl].map(screenToWorld);
    const aff = solveAffine(src, tgt);
    const { position, rotationZ, scale } = decomposeAffineToTRS(aff);
    set({
      signTX: position.x,
      signTY: position.y,
      signRZ: rotationZ,
      signScale: Math.max(0.05, (scale.x + scale.y) / 2 || 1),
      fitMode: false,
      fitPoints: [],
    });
  };

  // Arrow keys move Logo when Logo tool
  useEffect(() => {
    const onKey = (e) => {
      if (S.activeTool !== 'logo') return;
      const step = e.shiftKey ? 1 : 0.25;
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
        const t = { ...S.logoTransform };
        if (e.key === 'ArrowLeft') t.x -= step;
        if (e.key === 'ArrowRight') t.x += step;
        if (e.key === 'ArrowUp') t.y += step;
        if (e.key === 'ArrowDown') t.y -= step;
        clampToBounds(t, S.signType === 'pan' ? panelBounds : lettersBounds);
        set({ logoTransform: t });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [S.activeTool, S.logoTransform, S.signType, panelBounds, lettersBounds]);

  /* Nudge steps */
  const [signStep, setSignStep] = useState(0.5);
  const [lineStep, setLineStep] = useState(0.5);
  const [logoStep, setLogoStep] = useState(0.5);

  return (
    <div className="w-full h-full min-h-[850px] flex flex-col lg:flex-row gap-4 p-4 bg-neutral-950 text-neutral-100">
      {/* Sidebar */}
      <div className="lg:w-[720px] w-full bg-neutral-900 rounded-2xl p-4 space-y-4 shadow-xl overflow-y-auto max-h-[95vh]">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
              Sign Mockup — centered halo, raceways & logo
            </h1>
            <p className="text-sm opacity-70">
              ⌘/Ctrl+Z undo • Shift+⌘/Ctrl+Z or Ctrl+Y redo
            </p>
          </div>
          <div className="flex gap-2">
            <button
              className={`px-3 py-2 rounded ${
                canUndo ? 'bg-neutral-800' : 'bg-neutral-800/40'
              } border border-neutral-700`}
              onClick={undo}
              disabled={!canUndo}
            >
              Undo
            </button>
            <button
              className={`px-3 py-2 rounded ${
                canRedo ? 'bg-neutral-800' : 'bg-neutral-800/40'
              } border border-neutral-700`}
              onClick={redo}
              disabled={!canRedo}
            >
              Redo
            </button>
          </div>
        </div>

        {/* Tool */}
        <div className="grid grid-cols-3 gap-2">
          {['lines', 'logo', 'none'].map((t) => (
            <button
              key={t}
              onClick={() => set({ activeTool: t })}
              className={`p-2 rounded-lg border ${
                S.activeTool === t
                  ? 'bg-blue-500 border-blue-400 text-white'
                  : 'bg-neutral-800 border-neutral-700'
              }`}
            >
              {t === 'lines'
                ? 'Lines Tool'
                : t === 'logo'
                ? 'Logo Tool'
                : 'No Gizmos'}
            </button>
          ))}
        </div>

        {/* Nudges */}
        <div className="grid grid-cols-3 gap-3">
          <NudgePad
            label="Nudge Sign"
            step={signStep}
            setStep={setSignStep}
            onNudge={(dx, dy) =>
              set({
                signTX: +(S.signTX + dx).toFixed(2),
                signTY: +(S.signTY + dy).toFixed(2),
              })
            }
          />
          <NudgePad
            label={`Nudge Line ${S.activeLineIndex + 1}`}
            step={lineStep}
            setStep={setLineStep}
            onNudge={(dx, dy) => {
              const p = S.linePoses[S.activeLineIndex] ?? {
                x: 0,
                y: 0,
                rot: 0,
                scale: 1,
              };
              const np = { ...p, x: p.x + dx, y: p.y + dy };
              clampToBounds(np, lettersBounds);
              const arr = [...S.linePoses];
              arr[S.activeLineIndex] = np;
              set({ linePoses: arr });
            }}
          />
          <NudgePad
            label="Nudge Logo"
            step={logoStep}
            setStep={setLogoStep}
            onNudge={(dx, dy) => {
              const t = {
                ...S.logoTransform,
                x: S.logoTransform.x + dx,
                y: S.logoTransform.y + dy,
              };
              clampToBounds(
                t,
                S.signType === 'pan' ? panelBounds : lettersBounds
              );
              set({ logoTransform: t });
            }}
          />
        </div>

        {/* Photo */}
        <div className="space-y-2">
          <label className="block text-sm font-medium">Building Photo</label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => set({ file: e.target.files?.[0] ?? null })}
            className="w-full text-sm file:mr-3 file:px-4 file:py-2 file:rounded-lg file:border-0 file:bg-neutral-800 file:text-neutral-100"
          />
        </div>

        {/* 4-point fit */}
        <div className="space-y-2 border border-neutral-800 rounded-lg p-3">
          <div className="text-sm font-medium">Plane Snap (4 points)</div>
          <div className="text-xs opacity-70">
            Click, pick 4 corners (clockwise), Apply. You can still move things
            after.
          </div>
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => set({ fitMode: true, fitPoints: [] })}
              className="px-3 py-2 rounded bg-neutral-800 border border-neutral-700"
            >
              Start Picking
            </button>
            <button
              onClick={applyFourPointFit}
              className="px-3 py-2 rounded bg-blue-600 text-white"
              disabled={S.fitPoints.length !== 4}
            >
              Apply Fit
            </button>
            <button
              onClick={() => set({ fitMode: false, fitPoints: [] })}
              className="px-3 py-2 rounded bg-neutral-800 border border-neutral-700"
            >
              Clear
            </button>
          </div>
        </div>

        {/* Wall tilt */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs opacity-80">Tilt X ({S.bldTiltX}°)</div>
            <input
              type="range"
              min="-60"
              max="60"
              step="1"
              value={S.bldTiltX}
              onChange={(e) => set({ bldTiltX: Number(e.target.value) })}
              className="w-full h-2 bg-neutral-800 rounded-lg"
            />
          </div>
          <div>
            <div className="text-xs opacity-80">Tilt Y ({S.bldTiltY}°)</div>
            <input
              type="range"
              min="-60"
              max="60"
              step="1"
              value={S.bldTiltY}
              onChange={(e) => set({ bldTiltY: Number(e.target.value) })}
              className="w-full h-2 bg-neutral-800 rounded-lg"
            />
          </div>
        </div>

        {/* Sign Type */}
        <div className="space-y-2">
          <label className="block text-sm font-medium">Sign Type</label>
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => set({ signType: 'letters' })}
              className={`p-3 rounded-lg border ${
                S.signType === 'letters'
                  ? 'bg-blue-500 border-blue-400 text-white'
                  : 'bg-neutral-800 border-neutral-700'
              }`}
            >
              Channel Letters
            </button>
            <button
              onClick={() => set({ signType: 'pan' })}
              className={`p-3 rounded-lg border ${
                S.signType === 'pan'
                  ? 'bg-blue-500 border-blue-400 text-white'
                  : 'bg-neutral-800 border-neutral-700'
              }`}
            >
              Pan Sign
            </button>
            <button
              onClick={() => set({ showRaceway: !S.showRaceway })}
              className={`p-3 rounded-lg border ${
                S.showRaceway
                  ? 'bg-blue-500 border-blue-400 text-white'
                  : 'bg-neutral-800 border-neutral-700'
              }`}
            >
              Toggle Raceway
            </button>
          </div>
          {S.signType === 'pan' && (
            <>
              <label className="flex items-center gap-2 mt-2 text-sm">
                <input
                  type="checkbox"
                  checked={S.showLettersOnPan}
                  onChange={(e) => set({ showLettersOnPan: e.target.checked })}
                />
                Show text on panel (letters hidden by default)
              </label>
              <label className="flex items-center gap-2 mt-2 text-sm">
                <input
                  type="checkbox"
                  checked={S.showPanel}
                  onChange={(e) => set({ showPanel: e.target.checked })}
                />
                Show panel
              </label>
            </>
          )}
        </div>

        {/* Text */}
        <div className="space-y-2">
          <label className="block text-sm font-medium">Sign Text</label>
          <textarea
            value={S.text}
            onChange={(e) => set({ text: e.target.value || DEFAULT_TEXT })}
            placeholder={`YOUR\nSIGN`}
            className="w-full px-3 py-2 rounded-lg bg-neutral-800 border border-neutral-700 focus:border-blue-400 outline-none"
            rows={3}
            maxLength={200}
          />
          <div className="text-xs opacity-70">Use Enter for a new line.</div>
        </div>

        {/* Font */}
        <div className="space-y-2">
          <label className="block text-sm font-medium">Font</label>
          <select
            value={S.fontUrl}
            onChange={(e) => set({ fontUrl: e.target.value })}
            className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-2 py-2 text-sm"
          >
            {Object.entries(FONT_OPTIONS).map(([name, url]) => (
              <option key={name} value={url}>
                {name.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>

        {/* Lighting */}
        <div className="space-y-2 border-t border-neutral-800 pt-4">
          <label className="block text-sm font-medium">Lighting Style</label>
          <div className="grid grid-cols-1 gap-2">
            {[
              { key: 'front', label: 'Front-lit' },
              { key: 'halo', label: 'Reverse Halo' },
              { key: 'none', label: 'Non-lit' },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => set({ style: key })}
                className={`p-3 rounded-lg border text-left ${
                  S.style === key
                    ? 'bg-blue-500 border-blue-400 text-white'
                    : 'bg-neutral-800 border-neutral-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Halo Controls */}
        {S.style === 'halo' && (
          <div className="border-t border-neutral-800 pt-4 space-y-4">
            <div>
              <div className="text-sm font-medium">Halo Color</div>
              <input
                type="color"
                value={S.haloColor}
                onChange={(e) => set({ haloColor: e.target.value })}
                className="w-full h-12 rounded-lg border border-neutral-700 bg-neutral-800"
              />
            </div>
            <div>
              <div className="text-sm font-medium">
                Halo Strength ({S.haloStrength.toFixed(2)})
              </div>
              <input
                type="range"
                min="0.5"
                max="6"
                step="0.05"
                value={S.haloStrength}
                onChange={(e) => set({ haloStrength: Number(e.target.value) })}
                className="w-full h-2 bg-neutral-800 rounded-lg"
              />
            </div>
            <div>
              <div className="text-sm font-medium">
                Glow Size ({S.glowSize.toFixed(2)})
              </div>
              <input
                type="range"
                min="0"
                max="0.5"
                step="0.01"
                value={S.glowSize}
                onChange={(e) => set({ glowSize: Number(e.target.value) })}
                className="w-full h-2 bg-neutral-800 rounded-lg"
              />
            </div>
            <div>
              <div className="text-sm font-medium">
                Halo Spread ({S.bloomRadius.toFixed(2)})
              </div>
              <input
                type="range"
                min="0.1"
                max="6"
                step="0.05"
                value={S.bloomRadius}
                onChange={(e) => set({ bloomRadius: Number(e.target.value) })}
                className="w-full h-2 bg-neutral-800 rounded-lg"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-sm font-medium">
                  Offset X ({S.haloOffsetX.toFixed(2)})
                </div>
                <input
                  type="range"
                  min="-2"
                  max="2"
                  step="0.1"
                  value={S.haloOffsetX}
                  onChange={(e) => set({ haloOffsetX: Number(e.target.value) })}
                  className="w-full h-2 bg-neutral-800 rounded-lg"
                />
              </div>
              <div>
                <div className="text-sm font-medium">
                  Offset Y ({S.haloOffsetY.toFixed(2)})
                </div>
                <input
                  type="range"
                  min="-2"
                  max="2"
                  step="0.1"
                  value={S.haloOffsetY}
                  onChange={(e) => set({ haloOffsetY: Number(e.target.value) })}
                  className="w-full h-2 bg-neutral-800 rounded-lg"
                />
              </div>
            </div>
            <div className="text-xs opacity-70">
              Halo is locked behind letters; “Glow Size” enlarges the backplate;
              “Halo Spread” widens the bloom.
            </div>
          </div>
        )}

        {/* Time of Day */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Time of Day</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={S.timeOfDay}
            onChange={(e) => set({ timeOfDay: Number(e.target.value) })}
            className="w-full h-2 bg-neutral-800 rounded-lg"
          />
        </div>

        {/* Letter Size / Spacing */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Letter Size</label>
          <input
            type="range"
            min="4"
            max="120"
            value={S.size}
            onChange={(e) =>
              set({
                size: Number(e.target.value),
                racewayHeightUnits:
                  S.racewayHeightUnits === 0
                    ? Number(e.target.value) * 0.35
                    : S.racewayHeightUnits,
              })
            }
            className="w-full h-2 bg-neutral-800 rounded-lg"
          />
          <div className="text-xs opacity-80 text-center">{S.size}px</div>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Line Spacing</label>
          <input
            type="range"
            min="0.7"
            max="2.0"
            step="0.05"
            value={S.lineSpacing}
            onChange={(e) => set({ lineSpacing: Number(e.target.value) })}
            className="w-full h-2 bg-neutral-800 rounded-lg"
          />
        </div>

        {/* Sign TRS */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs opacity-80">
              Sign X ({S.signTX.toFixed(2)})
            </label>
            <input
              type="range"
              min={-60}
              max={60}
              step="0.1"
              value={S.signTX}
              onChange={(e) => set({ signTX: Number(e.target.value) })}
              className="w-full"
            />
          </div>
          <div>
            <label className="text-xs opacity-80">
              Sign Y ({S.signTY.toFixed(2)})
            </label>
            <input
              type="range"
              min={-40}
              max={40}
              step="0.1"
              value={S.signTY}
              onChange={(e) => set({ signTY: Number(e.target.value) })}
              className="w-full"
            />
          </div>
          <div>
            <label className="text-xs opacity-80">
              Sign Rot ({deg(S.signRZ).toFixed(0)}°)
            </label>
            <input
              type="range"
              min={-45}
              max={45}
              step="1"
              value={deg(S.signRZ)}
              onChange={(e) => set({ signRZ: rad(Number(e.target.value)) })}
              className="w-full"
            />
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Sign Scale</label>
          <input
            type="range"
            min="0.20"
            max="3.00"
            step="0.01"
            value={S.signScale}
            onChange={(e) => set({ signScale: Number(e.target.value) })}
            className="w-full h-2 bg-neutral-800 rounded-lg"
          />
        </div>

        {/* Per-line width stretch */}
        <div className="border-t border-neutral-800 pt-4 space-y-3">
          <h3 className="text-lg font-semibold">Line Sizing (width)</h3>
          {uiLines.map((_, i) => (
            <div key={`line-sizer-${i}`} className="space-y-2">
              <label className="text-sm font-medium">
                Line {i + 1} Width (
                {S.perLineWidthScale[i]?.toFixed(2) || '1.00'}×)
              </label>
              <input
                type="range"
                min="0.20"
                max="3.00"
                step="0.01"
                value={S.perLineWidthScale[i] ?? 1}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  const arr = [...S.perLineWidthScale];
                  arr[i] = v;
                  set({ perLineWidthScale: arr });
                }}
                className="w-full h-2 bg-neutral-800 rounded-lg"
              />
            </div>
          ))}
        </div>

        {/* Colors */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium">Face Color</label>
            <input
              type="color"
              value={S.faceColor}
              onChange={(e) => set({ faceColor: e.target.value })}
              className="w-full h-12 rounded-lg border border-neutral-700 bg-neutral-800"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Trim Color</label>
            <input
              type="color"
              value={S.trimColor}
              onChange={(e) => set({ trimColor: e.target.value })}
              className="w-full h-12 rounded-lg border border-neutral-700 bg-neutral-800"
            />
          </div>
        </div>

        {/* Pan extras */}
        {S.signType === 'pan' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Panel Color</label>
                <input
                  type="color"
                  value={S.panelColor}
                  onChange={(e) => set({ panelColor: e.target.value })}
                  className="w-full h-12 rounded-lg border border-neutral-700 bg-neutral-800"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Panel Depth</label>
                <input
                  type="range"
                  min="0.05"
                  max="0.6"
                  step="0.01"
                  value={S.panelDepth}
                  onChange={(e) => set({ panelDepth: Number(e.target.value) })}
                  className="w-full h-2 bg-neutral-800 rounded-lg"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Panel Pad X</label>
                <input
                  type="range"
                  min="0"
                  max={Math.floor(S.size * 4)}
                  value={S.panelPadX}
                  onChange={(e) => set({ panelPadX: Number(e.target.value) })}
                  className="w-full h-2 bg-neutral-800 rounded-lg"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Panel Pad Y</label>
                <input
                  type="range"
                  min="0"
                  max={Math.floor(S.size * 3)}
                  value={S.panelPadY}
                  onChange={(e) => set({ panelPadY: Number(e.target.value) })}
                  className="w-full h-2 bg-neutral-800 rounded-lg"
                />
              </div>
            </div>
          </>
        )}

        {/* Per-line gizmo + snapping */}
        <div className="border-t border-neutral-800 pt-4 space-y-3">
          <h3 className="text-lg font-semibold">Per-Line Controls</h3>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={S.enableLineSizers}
              onChange={(e) => set({ enableLineSizers: e.target.checked })}
            />
            Enable on-canvas gizmo (Lines tool)
          </label>
          <div className="grid grid-cols-3 gap-2">
            {['translate', 'rotate', 'scale'].map((m) => (
              <button
                key={m}
                onClick={() => set({ transformMode: m })}
                className={`p-2 rounded-lg border ${
                  S.transformMode === m
                    ? 'bg-blue-500 border-blue-400 text-white'
                    : 'bg-neutral-800 border-neutral-700'
                }`}
              >
                {m[0].toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Active Line</label>
            <select
              value={S.activeLineIndex}
              onChange={(e) => set({ activeLineIndex: Number(e.target.value) })}
              className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-2 py-2 text-sm"
            >
              {uiLines.map((_, i) => (
                <option key={i} value={i}>
                  Line {i + 1}
                </option>
              ))}
            </select>
          </div>
          <div className="border border-neutral-800 rounded-lg p-3 space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={S.snapEnabled}
                onChange={(e) => set({ snapEnabled: e.target.checked })}
              />
              Snap while moving/rotating/scaling
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs opacity-80">Grid Step</label>
                <input
                  type="range"
                  min="0.1"
                  max="2"
                  step="0.1"
                  value={S.snapStep}
                  onChange={(e) => set({ snapStep: Number(e.target.value) })}
                  className="w-full h-2 bg-neutral-800 rounded-lg"
                />
              </div>
              <div>
                <label className="text-xs opacity-80">Angle Step (°)</label>
                <input
                  type="range"
                  min="1"
                  max="30"
                  step="1"
                  value={S.snapAngleDeg}
                  onChange={(e) =>
                    set({ snapAngleDeg: Number(e.target.value) })
                  }
                  className="w-full h-2 bg-neutral-800 rounded-lg"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Logo controls — always visible + 30× */}
        <div className="border-t border-neutral-800 pt-4 space-y-3">
          <h3 className="text-lg font-semibold">
            Logo (PNG/SVG) — full transform
          </h3>
          <input
            type="file"
            accept="image/png,image/svg+xml"
            onChange={(e) => set({ logoFile: e.target.files?.[0] ?? null })}
            className="w-full text-sm file:mr-3 file:px-4 file:py-2 file:rounded-lg file:border-0 file:bg-neutral-800 file:text-neutral-100"
          />
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs opacity-80">
                X ({S.logoTransform.x.toFixed(2)})
              </label>
              <input
                type="range"
                min={-120}
                max={120}
                step="0.1"
                value={S.logoTransform.x}
                onChange={(e) => {
                  const t = { ...S.logoTransform, x: Number(e.target.value) };
                  clampToBounds(
                    t,
                    S.signType === 'pan' ? panelBounds : lettersBounds
                  );
                  set({ logoTransform: t });
                }}
                className="w-full"
              />
            </div>
            <div>
              <label className="text-xs opacity-80">
                Y ({S.logoTransform.y.toFixed(2)})
              </label>
              <input
                type="range"
                min={-80}
                max={80}
                step="0.1"
                value={S.logoTransform.y}
                onChange={(e) => {
                  const t = { ...S.logoTransform, y: Number(e.target.value) };
                  clampToBounds(
                    t,
                    S.signType === 'pan' ? panelBounds : lettersBounds
                  );
                  set({ logoTransform: t });
                }}
                className="w-full"
              />
            </div>
            <div>
              <label className="text-xs opacity-80">
                Rotate ({deg(S.logoTransform.rot).toFixed(0)}°)
              </label>
              <input
                type="range"
                min={-180}
                max={180}
                step="1"
                value={deg(S.logoTransform.rot)}
                onChange={(e) =>
                  set({
                    logoTransform: {
                      ...S.logoTransform,
                      rot: rad(Number(e.target.value)),
                    },
                  })
                }
                className="w-full"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">
                Base Width ({(S.logoBaseWidth || logoDefaultWidth).toFixed(1)})
              </label>
              <input
                type="range"
                min="0.5"
                max={Math.max(
                  300,
                  Math.floor((lettersBounds.width || 40) * 10)
                )}
                step="0.1"
                value={S.logoBaseWidth || logoDefaultWidth}
                onChange={(e) => set({ logoBaseWidth: Number(e.target.value) })}
                className="w-full h-2 bg-neutral-800 rounded-lg"
              />
            </div>
            <div>
              <label className="text-sm font-medium">
                Scale ({S.logoTransform.scl.toFixed(2)}×)
              </label>
              <input
                type="range"
                min="0.2"
                max="30"
                step="0.01"
                value={S.logoTransform.scl}
                onChange={(e) =>
                  set({
                    logoTransform: {
                      ...S.logoTransform,
                      scl: Number(e.target.value),
                    },
                  })
                }
                className="w-full h-2 bg-neutral-800 rounded-lg"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {['translate', 'rotate', 'scale'].map((m) => (
              <button
                key={m}
                onClick={() => set({ logoGizmoMode: m })}
                className={`p-2 rounded-lg border ${
                  S.logoGizmoMode === m
                    ? 'bg-blue-500 border-blue-400 text-white'
                    : 'bg-neutral-800 border-neutral-700'
                }`}
              >
                {m[0].toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
          <div className="text-xs opacity-70">
            Pick “Logo Tool” to drag/rotate/scale with the gizmo; arrow keys
            also move the logo (Shift = big steps). Logo always remains visible.
          </div>
        </div>
      </div>

      {/* Preview */}
      <div className="flex-1 flex flex-col items-center justify-center">
        <div
          className="relative rounded-2xl overflow-hidden shadow-2xl bg-neutral-800"
          style={{ width: dispW, height: dispH }}
        >
          {/* Background */}
          <Canvas
            gl={{
              alpha: true,
              antialias: true,
              premultipliedAlpha: false,
              preserveDrawingBuffer: true,
            }}
            dpr={[1, 2]}
            camera={{ position: [0, 0, 260], fov: 35 }}
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 0,
              pointerEvents: 'none',
            }}
            onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
          >
            <Environment preset={envPreset} background={false} />
            {imgURL ? (
              <BuildingPlane3D
                imageURL={imgURL}
                planeWidth={120}
                tiltX={S.bldTiltX}
                tiltY={S.bldTiltY}
                z={-1}
              />
            ) : (
              <mesh>
                <planeGeometry args={[120, 67.5]} />
                <meshBasicMaterial color="#2a2a2a" />
              </mesh>
            )}
          </Canvas>

          {/* 4-point overlay */}
          <FourPointFitOverlay
            enabled={S.fitMode}
            size={{ w: dispW, h: dispH }}
            points={S.fitPoints}
            onPointsChange={(pts) => set({ fitPoints: pts })}
            onApply={applyFourPointFit}
            onCancel={() => set({ fitMode: false, fitPoints: [] })}
          />

          {/* Day/Night overlay */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: `rgba(0,0,0,${overlayAlpha})`, zIndex: 0 }}
          />

          {/* Halo pass */}
          {S.style === 'halo' && (
            <Canvas
              gl={{
                alpha: true,
                antialias: true,
                premultipliedAlpha: false,
                preserveDrawingBuffer: true,
              }}
              dpr={[1, 2]}
              camera={{ position: [0, 0, 260], fov: 35 }}
              style={{
                position: 'absolute',
                inset: 0,
                zIndex: 1,
                pointerEvents: 'none',
              }}
              onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
            >
              <ambientLight intensity={ambientI * 0.8} />
              <directionalLight
                position={[60, 80, 120]}
                intensity={dirI * 0.8}
              />
              <Environment preset={envPreset} background={false} />

              <group rotation={[rad(S.bldTiltX), rad(S.bldTiltY), 0]}>
                <group
                  position={[S.signTX, S.signTY, 0]}
                  rotation={[0, 0, S.signRZ]}
                  scale={[S.signScale, S.signScale, S.signScale]}
                >
                  <HaloOnly
                    text={S.text}
                    fontUrl={S.fontUrl}
                    depth={6}
                    size={S.size}
                    lineSpacing={S.lineSpacing}
                    haloColor={S.haloColor}
                    haloStrength={S.haloStrength}
                    glowSize={S.glowSize}
                    bloomRadius={S.bloomRadius}
                    haloOffsetX={S.haloOffsetX}
                    haloOffsetY={S.haloOffsetY}
                    perLineWidthScale={S.perLineWidthScale}
                    linePoses={S.linePoses}
                  />
                </group>
              </group>
            </Canvas>
          )}

          {/* Foreground (interactive) */}
          <Canvas
            gl={{
              alpha: true,
              antialias: true,
              premultipliedAlpha: false,
              preserveDrawingBuffer: true,
            }}
            dpr={[1, 2]}
            camera={{ position: [0, 0, 260], fov: 35 }}
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 2,
              pointerEvents: 'auto',
            }}
            onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
          >
            <ambientLight intensity={ambientI} />
            <directionalLight position={[60, 80, 120]} intensity={dirI} />
            <Environment preset={envPreset} background={false} />

            <group rotation={[rad(S.bldTiltX), rad(S.bldTiltY), 0]}>
              <Suspense fallback={null}>
                <group
                  position={[S.signTX, S.signTY, 0]}
                  rotation={[0, 0, S.signRZ]}
                  scale={[S.signScale, S.signScale, S.signScale]}
                >
                  <ChannelLettersAndPanel
                    signType={S.signType}
                    showLetters={lettersVisible}
                    text={S.text}
                    fontUrl={S.fontUrl}
                    depth={6}
                    size={S.size}
                    faceColor={S.faceColor}
                    trimColor={S.trimColor}
                    showRaceway={S.showRaceway}
                    racewayColor={S.racewayColor}
                    racewayHeightUnits={S.racewayHeightUnits}
                    racewayPadUnits={S.racewayPadUnits}
                    racewayYOffsetUnits={S.racewayYOffsetUnits}
                    racewayZOrder={S.racewayZOrder}
                    lineSpacing={S.lineSpacing}
                    perLineRaceway={S.perLineRaceway}
                    perLinePadUnits={S.perLinePadUnits}
                    perLineHeightUnits={S.perLineHeightUnits}
                    perLineWidthScale={S.perLineWidthScale}
                    showPanel={S.signType === 'pan' && S.showPanel}
                    panelColor={S.panelColor}
                    panelDepth={S.panelDepth}
                    panelPadX={S.panelPadX}
                    panelPadY={S.panelPadY}
                    textOnlyRef={textOnlyRef}
                    enableLineSizers={S.enableLineSizers}
                    activeLineIndex={S.activeLineIndex}
                    linePoses={S.linePoses}
                    onLinePoseChange={(i, pose) => {
                      const next = [...S.linePoses];
                      next[i] = pose;
                      set({ linePoses: next });
                    }}
                    transformMode={S.transformMode}
                    boundsForLines={lettersBounds}
                    snapEnabled={S.snapEnabled}
                    snapStep={S.snapStep}
                    snapAngleDeg={S.snapAngleDeg}
                    activeTool={S.activeTool}
                    onClickLine={(i) => set({ activeLineIndex: i })}
                  />

                  {/* LOGO — always visible; controls only when Logo tool is active */}
                  {S.logoFile && (
                    <>
                      {(() => {
                        const bounds =
                          S.signType === 'pan' && S.showPanel
                            ? panelBounds
                            : lettersBounds;
                        const type = /\.svg$/i.test(S.logoFile?.name || '')
                          ? 'svg'
                          : 'raster';
                        return (
                          <LogoGraphic
                            url={logoURL}
                            type={type}
                            baseWidth={S.logoBaseWidth || logoDefaultWidth}
                            transform={S.logoTransform}
                            setTransform={(t) => set({ logoTransform: t })}
                            bounds={bounds}
                            gizmoMode={S.logoGizmoMode}
                            controlsEnabled={S.activeTool === 'logo'}
                            snapStep={S.snapEnabled ? S.snapStep : 0}
                          />
                        );
                      })()}
                    </>
                  )}
                </group>
              </Suspense>
            </group>
          </Canvas>
        </div>
      </div>
    </div>
  );
}
