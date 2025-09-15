import React, {
  useRef,
  useState,
  useEffect,
  useMemo,
  useLayoutEffect,
  Suspense,
} from 'react';
import { Canvas } from '@react-three/fiber';
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

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Building plane                                                      */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Logo (PNG/SVG) — no bounds, guarded loaders                        */
/* ------------------------------------------------------------------ */

function LogoGraphic({
  url,
  type, // 'svg' | 'raster'
  baseWidth = 12,
  depth = 0.15,
  transform, // { x, y, rot, scl }
  setTransform,
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
  }, [transform, type]);

  const Content = () => {
    if (type === 'svg') {
      const [geom, setGeom] = useState(null);
      useEffect(() => {
        let mounted = true;
        (async () => {
          const { SVGLoader } = await import(
            'three/examples/jsm/loaders/SVGLoader'
          );
          const loader = new SVGLoader();
          loader.load(
            url,
            (data) => {
              if (!mounted) return;
              const shapes = data.paths.flatMap((p) => p.toShapes(true));
              const g = new THREE.ExtrudeGeometry(shapes, {
                depth,
                bevelEnabled: false,
              });
              g.center();
              g.computeBoundingBox();
              const bb = g.boundingBox;
              const w = Math.max(1e-3, bb.max.x - bb.min.x || 1);
              const s = baseWidth / w;
              g.scale(s, s, s);
              setGeom(g);
            },
            undefined,
            () => setGeom(null) // if it fails, just show nothing (no crash/black)
          );
        })();
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
    <group
      ref={groupRef}
      key={url /* reset safely on upload */}
      onPointerDown={(e) => e.stopPropagation()}
    >
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

/* ------------------------------------------------------------------ */
/* Channel Letters + Panel + Raceways                                  */
/* ------------------------------------------------------------------ */

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
  snapEnabled,
  snapStep,
  snapAngleDeg,
  activeTool,
  onClickLine,
}) {
  const lines = (text && text.length ? text : DEFAULT_TEXT)
    .split('\n')
    .map((s) => s.trimEnd());
  const step = size * (lineSpacing || 1.1);
  const firstY = ((lines.length - 1) * step) / 2;

  // Robust width measuring (after geometry update + center)
  const [lineLocalWidths, setLineLocalWidths] = useState([]);
  const widthsRef = useRef([]);
  const countRef = useRef(0);

  useEffect(() => {
    widthsRef.current = [];
    setLineLocalWidths([]);
    countRef.current = 0;
  }, [text, size, lineSpacing, fontUrl, perLineWidthScale]);

  useEffect(() => {
    if (countRef.current === lines.length && lines.length > 0) {
      setLineLocalWidths(widthsRef.current.slice());
    }
  }, [lines.length, countRef.current]);

  const handleUpdateWidth = (i, g) => {
    if (!g) return;
    g.center?.();
    g.computeBoundingBox?.();
    const bb = g.boundingBox;
    const width = Math.max(1e-3, (bb?.max.x ?? 0) - (bb?.min.x ?? 0));
    widthsRef.current[i] = width;
    countRef.current += 1;
  };

  // Hidden text for overall panel bounds
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
              onUpdate={(g) => g.center?.()}
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

  // Panel dims from hidden text (after one frame to settle)
  const [panelDims, setPanelDims] = useState({ w: 4, h: 2 });
  useLayoutEffect(() => {
    const grp = textOnlyRef?.current;
    if (!grp) return;
    const id = requestAnimationFrame(() => {
      const box = new THREE.Box3().setFromObject(grp);
      const w = Math.max(0.001, box.max.x - box.min.x);
      const h = Math.max(0.001, box.max.y - box.min.y);
      setPanelDims({ w: w + panelPadX * 2, h: h + panelPadY * 2 });
    });
    return () => cancelAnimationFrame(id);
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

  const applySnap = (g) => {
    if (!snapEnabled || !g) return;
    g.position.x = Math.round(g.position.x / snapStep) * snapStep;
    g.position.y = Math.round(g.position.y / snapStep) * snapStep;
    const d = deg(g.rotation.z || 0);
    g.rotation.z = rad(Math.round(d / snapAngleDeg) * snapAngleDeg);
    const s = g.scale?.x ?? 1;
    const snappedS = Math.max(0.2, Math.round(s / 0.05) * 0.05);
    g.scale.set(snappedS, snappedS, snappedS);
  };

  return (
    <group>
      <HiddenTextOnly />

      {/* Panel */}
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

      {/* Lines */}
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

        // Compute raceway width in the SAME local space as text:
        const baseW = lineLocalWidths[i] || 0; // set after measure
        const rwPad = (perLinePadUnits?.[i] ?? racewayPadUnits ?? 0) * 2;
        const rwHeight = Math.max(
          perLineHeightUnits?.[i] ?? racewayHeightUnits ?? size * 0.35,
          size * 0.12
        );
        const rwWidthLocal = Math.max(
          (baseW || size * 4) * widthScale + rwPad,
          size * 2
        );

        const Inner = (
          <group scale={[widthScale, 1, 1]}>
            {/* Raceway in the same local group as text => stays centered */}
            {showRaceway && perLineRaceway && (
              <mesh position={[0, racewayYOffsetUnits, racewayZ]}>
                <boxGeometry
                  args={[rwWidthLocal, rwHeight, Math.max(racewayDepth, 0.2)]}
                />
                <meshBasicMaterial color={racewayColor} />
              </mesh>
            )}

            {showLetters && (
              <Text3D
                font={fontUrl}
                size={size}
                height={depth}
                bevelEnabled
                bevelSize={Math.min(0.02 * size, 2)}
                bevelThickness={Math.min(0.02 * depth, 1)}
                curveSegments={8}
                onUpdate={(g) => handleUpdateWidth(i, g)}
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
              {Inner}
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
              applySnap(g);
              onPoseChange(i, g, defaultY);
            }}
          >
            <group {...groupProps}>{Inner}</group>
          </TransformControls>
        );
      })}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Halo — exact same TRS chain as letters                             */
/* ------------------------------------------------------------------ */

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
  const haloColor3 = useMemo(
    () => new THREE.Color(haloColor || '#ffffff'),
    [haloColor]
  );
  const lines = (text && text.length ? text : DEFAULT_TEXT)
    .split('\n')
    .map((s) => s.trimEnd());
  const step = size * (lineSpacing || 1.1);
  const firstY = ((lines.length - 1) * step) / 2;

  const zBack = -(depth * (1.15 + glowSize)); // scale backplate rearwards (not sideways)
  const glowS = 1 + glowSize; // uniform enlargement for glow

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
                position={[haloOffsetX, haloOffsetY, zBack]}
                scale={[glowS, glowS, 1]}
              >
                <Text3D
                  font={fontUrl}
                  size={size}
                  height={depth}
                  bevelEnabled
                  bevelSize={Math.min(0.02 * size, 2)}
                  bevelThickness={Math.min(0.02 * depth, 1)}
                  curveSegments={8}
                  onUpdate={(g) => g.center?.()}
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
          radius={bloomRadius} // true bloom spread
          luminanceThreshold={0.0}
          luminanceSmoothing={0.02}
          mipmapBlur
        />
      </EffectComposer>
    </Selection>
  );
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

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
    glowSize: 0.08, // backplate enlargement (0..0.5)
    bloomRadius: 0.6, // post bloom radius
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
  }));
  const set = (patch) => setS((p) => ({ ...p, ...patch }));

  const imgURL = useObjectURL(S.file);
  const logoURL = useObjectURL(S.logoFile);

  // read image size for plane aspect
  useEffect(() => {
    if (!imgURL) return;
    const i = new Image();
    i.onload = () => set({ imgW: i.naturalWidth, imgH: i.naturalHeight });
    i.src = imgURL;
  }, [imgURL]);

  // lighting
  const ambientI = THREE.MathUtils.lerp(0.35, 0.06, S.timeOfDay);
  const dirI = THREE.MathUtils.lerp(0.75, 0.22, S.timeOfDay);
  const overlayAlpha = THREE.MathUtils.lerp(0.0, 0.65, S.timeOfDay);
  const envPreset = S.timeOfDay > 0.6 ? 'night' : 'sunset';

  // derived lines
  const uiLines = useMemo(
    () =>
      (S.text && S.text.length ? S.text : DEFAULT_TEXT)
        .split('\n')
        .map((s) => s.trimEnd()),
    [S.text]
  );

  // keep per-line arrays sized
  useEffect(() => {
    const n = uiLines.length;
    set((prev) => {
      const pad = Array.from(
        { length: n },
        (_, i) => prev.perLinePadUnits[i] ?? prev.racewayPadUnits ?? 0
      );
      const hgt = Array.from(
        { length: n },
        (_, i) => prev.perLineHeightUnits[i] ?? prev.size * 0.35
      );
      const wid = Array.from(
        { length: n },
        (_, i) => prev.perLineWidthScale[i] ?? 1
      );
      return {
        perLinePadUnits: pad,
        perLineHeightUnits: hgt,
        perLineWidthScale: wid,
      };
    });
  }, [uiLines.length, S.racewayPadUnits, S.size]);

  // keep poses aligned with default layout & preserve offsets
  useEffect(() => {
    const n = uiLines.length;
    const baseline = S.size * (S.lineSpacing || 1.1);
    const firstY = ((n - 1) * baseline) / 2;
    set((prev) => {
      const next = Array.from({ length: n }, (_, i) => {
        const defaultY = firstY - i * baseline;
        const p = prev.linePoses[i];
        if (!p)
          return {
            x: 0,
            y: defaultY,
            rot: 0,
            scale: 1,
            _defaultY: defaultY,
            _baseline: baseline,
          };
        if (
          typeof p._baseline === 'number' &&
          typeof p._defaultY === 'number'
        ) {
          const oldB = p._baseline;
          const oldFirstY = ((n - 1) * oldB) / 2;
          const idx = Math.round((oldFirstY - p._defaultY) / oldB);
          const newDefault = firstY - idx * baseline;
          const offset = p.y - p._defaultY;
          return {
            ...p,
            y: newDefault + offset,
            _defaultY: newDefault,
            _baseline: baseline,
          };
        }
        return { ...p, y: defaultY, _defaultY: defaultY, _baseline: baseline };
      });
      return { linePoses: next };
    });
  }, [uiLines.length, S.size, S.lineSpacing]);

  // display size
  const maxW = Math.min(
    1400,
    typeof window !== 'undefined' ? window.innerWidth * 0.75 : 1000
  );
  const dispW = Math.max(640, Math.min(maxW, S.imgW));
  const dispH = S.imgH * (dispW / S.imgW);

  // refs
  const textOnlyRef = useRef();

  // letters visibility on pan
  const lettersVisible =
    S.signType === 'letters' || (S.signType === 'pan' && S.showLettersOnPan);

  // default logo base width from text block
  const getTextOnlyWorldSize = () => {
    const grp = textOnlyRef.current;
    if (!grp) return { w: 1, h: 1 };
    const box = new THREE.Box3().setFromObject(grp);
    return {
      w: Math.max(0.001, box.max.x - box.min.x),
      h: Math.max(0.001, box.max.y - box.min.y),
    };
  };
  const logoDefaultWidth = useMemo(() => {
    const { w } = getTextOnlyWorldSize();
    return Math.max(0.5, (w || S.size * 4) * 0.6);
  }, [S.text, S.size, S.lineSpacing]);

  // UI helpers
  const [signStep, setSignStep] = useState(0.5);
  const [lineStep, setLineStep] = useState(0.5);
  const [logoStep, setLogoStep] = useState(0.5);

  return (
    <div className="w-full h-full min-h-[850px] flex flex-col lg:flex-row gap-4 p-4 bg-neutral-950 text-neutral-100">
      {/* Controls */}
      <div className="lg:w-[720px] w-full bg-neutral-900 rounded-2xl p-4 space-y-4 shadow-xl overflow-y-auto max-h-[95vh]">
        <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
          Sign Mockup — centered halo, centered raceways & free-move logo
        </h1>

        {/* Tool tabs */}
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

        {/* Nudgers */}
        <div className="grid grid-cols-3 gap-3">
          <Nudge
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
          <Nudge
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
              const arr = [...S.linePoses];
              arr[S.activeLineIndex] = { ...p, x: p.x + dx, y: p.y + dy };
              set({ linePoses: arr });
            }}
          />
          <Nudge
            label="Nudge Logo"
            step={logoStep}
            setStep={setLogoStep}
            onNudge={(dx, dy) =>
              set({
                logoTransform: {
                  ...S.logoTransform,
                  x: S.logoTransform.x + dx,
                  y: S.logoTransform.y + dy,
                },
              })
            }
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

        {/* Tilt */}
        <div className="grid grid-cols-2 gap-3">
          <Range
            label={`Tilt X (${S.bldTiltX}°)`}
            min={-60}
            max={60}
            step={1}
            value={S.bldTiltX}
            onChange={(v) => set({ bldTiltX: v })}
          />
          <Range
            label={`Tilt Y (${S.bldTiltY}°)`}
            min={-60}
            max={60}
            step={1}
            value={S.bldTiltY}
            onChange={(v) => set({ bldTiltY: v })}
          />
        </div>

        {/* Sign Type */}
        <div className="space-y-2">
          <label className="block text-sm font-medium">Sign Type</label>
          <div className="grid grid-cols-3 gap-2">
            <Btn
              onClick={() => set({ signType: 'letters' })}
              active={S.signType === 'letters'}
            >
              Channel Letters
            </Btn>
            <Btn
              onClick={() => set({ signType: 'pan' })}
              active={S.signType === 'pan'}
            >
              Pan Sign
            </Btn>
            <Btn
              onClick={() => set({ showRaceway: !S.showRaceway })}
              active={S.showRaceway}
            >
              Toggle Raceway
            </Btn>
          </div>
          {S.signType === 'pan' && (
            <>
              <label className="flex items-center gap-2 mt-2 text-sm">
                <input
                  type="checkbox"
                  checked={S.showLettersOnPan}
                  onChange={(e) => set({ showLettersOnPan: e.target.checked })}
                />
                Show text on panel (unchecked hides letters on pan)
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
          <div className="text-xs opacity-70">Enter starts a new line.</div>
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

        {/* Lighting style */}
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
            <Color
              label="Halo Color"
              value={S.haloColor}
              onChange={(v) => set({ haloColor: v })}
            />
            <Range
              label={`Halo Strength (${S.haloStrength.toFixed(2)})`}
              min={0.5}
              max={6}
              step={0.05}
              value={S.haloStrength}
              onChange={(v) => set({ haloStrength: v })}
            />
            <Range
              label={`Glow Size (${S.glowSize.toFixed(2)})`}
              min={0}
              max={0.5}
              step={0.01}
              value={S.glowSize}
              onChange={(v) => set({ glowSize: v })}
            />
            <Range
              label={`Halo Spread (${S.bloomRadius.toFixed(2)})`}
              min={0.1}
              max={6}
              step={0.05}
              value={S.bloomRadius}
              onChange={(v) => set({ bloomRadius: v })}
            />
            <div className="grid grid-cols-2 gap-3">
              <Range
                label={`Offset X (${S.haloOffsetX.toFixed(2)})`}
                min={-2}
                max={2}
                step={0.1}
                value={S.haloOffsetX}
                onChange={(v) => set({ haloOffsetX: v })}
              />
              <Range
                label={`Offset Y (${S.haloOffsetY.toFixed(2)})`}
                min={-2}
                max={2}
                step={0.1}
                value={S.haloOffsetY}
                onChange={(v) => set({ haloOffsetY: v })}
              />
            </div>
          </div>
        )}

        {/* Time of Day */}
        <Range
          label="Time of Day"
          min={0}
          max={1}
          step={0.01}
          value={S.timeOfDay}
          onChange={(v) => set({ timeOfDay: v })}
        />

        {/* Size & spacing */}
        <Range
          label="Letter Size"
          min={4}
          max={120}
          step={1}
          value={S.size}
          onChange={(v) =>
            set({
              size: v,
              racewayHeightUnits:
                S.racewayHeightUnits === 0 ? v * 0.35 : S.racewayHeightUnits,
            })
          }
        />
        <Range
          label={`Line Spacing (${S.lineSpacing.toFixed(2)}×)`}
          min={0.7}
          max={2}
          step={0.05}
          value={S.lineSpacing}
          onChange={(v) => set({ lineSpacing: v })}
        />

        {/* Sign transform */}
        <div className="grid grid-cols-3 gap-3">
          <Range
            label={`Sign X (${S.signTX.toFixed(2)})`}
            min={-120}
            max={120}
            step={0.1}
            value={S.signTX}
            onChange={(v) => set({ signTX: v })}
          />
          <Range
            label={`Sign Y (${S.signTY.toFixed(2)})`}
            min={-80}
            max={80}
            step={0.1}
            value={S.signTY}
            onChange={(v) => set({ signTY: v })}
          />
          <Range
            label={`Sign Rot (${deg(S.signRZ).toFixed(0)}°)`}
            min={-45}
            max={45}
            step={1}
            value={deg(S.signRZ)}
            onChange={(v) => set({ signRZ: rad(v) })}
          />
        </div>
        <Range
          label={`Sign Scale (${S.signScale.toFixed(2)}×)`}
          min={0.2}
          max={3}
          step={0.01}
          value={S.signScale}
          onChange={(v) => set({ signScale: v })}
        />

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
                className="w-full h-2 bg-neutral-800 rounded-lg appearance-none cursor-pointer"
              />
            </div>
          ))}
        </div>

        {/* Colors */}
        <div className="grid grid-cols-2 gap-3">
          <Color
            label="Face Color"
            value={S.faceColor}
            onChange={(v) => set({ faceColor: v })}
          />
          <Color
            label="Trim Color"
            value={S.trimColor}
            onChange={(v) => set({ trimColor: v })}
          />
        </div>

        {/* Pan extras */}
        {S.signType === 'pan' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Color
                label="Panel Color"
                value={S.panelColor}
                onChange={(v) => set({ panelColor: v })}
              />
              <Range
                label="Panel Depth"
                min={0.05}
                max={0.6}
                step={0.01}
                value={S.panelDepth}
                onChange={(v) => set({ panelDepth: v })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Range
                label={`Panel Pad X (${S.panelPadX})`}
                min={0}
                max={Math.floor(S.size * 4)}
                step={1}
                value={S.panelPadX}
                onChange={(v) => set({ panelPadX: v })}
              />
              <Range
                label={`Panel Pad Y (${S.panelPadY})`}
                min={0}
                max={Math.floor(S.size * 3)}
                step={1}
                value={S.panelPadY}
                onChange={(v) => set({ panelPadY: v })}
              />
            </div>
          </>
        )}

        {/* Line gizmo + snapping */}
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
              <Range
                label={`Grid Step (${S.snapStep.toFixed(1)})`}
                min={0.1}
                max={2}
                step={0.1}
                value={S.snapStep}
                onChange={(v) => set({ snapStep: v })}
              />
              <Range
                label={`Angle Step (${S.snapAngleDeg}°)`}
                min={1}
                max={30}
                step={1}
                value={S.snapAngleDeg}
                onChange={(v) => set({ snapAngleDeg: v })}
              />
            </div>
          </div>
        </div>

        {/* Logo controls — free movement */}
        <div className="border-t border-neutral-800 pt-4 space-y-3">
          <h3 className="text-lg font-semibold">Logo (PNG/SVG) — free move</h3>
          <input
            type="file"
            accept="image/png,image/svg+xml"
            onChange={(e) => set({ logoFile: e.target.files?.[0] ?? null })}
            className="w-full text-sm file:mr-3 file:px-4 file:py-2 file:rounded-lg file:border-0 file:bg-neutral-800 file:text-neutral-100"
          />
          <div className="grid grid-cols-3 gap-3">
            <Range
              label={`X (${S.logoTransform.x.toFixed(2)})`}
              min={-300}
              max={300}
              step={0.1}
              value={S.logoTransform.x}
              onChange={(v) =>
                set({ logoTransform: { ...S.logoTransform, x: v } })
              }
            />
            <Range
              label={`Y (${S.logoTransform.y.toFixed(2)})`}
              min={-200}
              max={200}
              step={0.1}
              value={S.logoTransform.y}
              onChange={(v) =>
                set({ logoTransform: { ...S.logoTransform, y: v } })
              }
            />
            <Range
              label={`Rotate (${deg(S.logoTransform.rot).toFixed(0)}°)`}
              min={-180}
              max={180}
              step={1}
              value={deg(S.logoTransform.rot)}
              onChange={(v) =>
                set({ logoTransform: { ...S.logoTransform, rot: rad(v) } })
              }
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Range
              label={`Base Width (${(
                S.logoBaseWidth || logoDefaultWidth
              ).toFixed(1)})`}
              min={0.5}
              max={600}
              step={0.1}
              value={S.logoBaseWidth || logoDefaultWidth}
              onChange={(v) => set({ logoBaseWidth: v })}
            />
            <Range
              label={`Scale (${S.logoTransform.scl.toFixed(2)}×)`}
              min={0.2}
              max={30}
              step={0.01}
              value={S.logoTransform.scl}
              onChange={(v) =>
                set({ logoTransform: { ...S.logoTransform, scl: v } })
              }
            />
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
            No bounds: drag with Logo Tool gizmo or use arrow keys (Shift = big
            steps).
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
                    snapEnabled={S.snapEnabled}
                    snapStep={S.snapStep}
                    snapAngleDeg={S.snapAngleDeg}
                    activeTool={S.activeTool}
                    onClickLine={(i) => set({ activeLineIndex: i })}
                  />

                  {/* LOGO — absolutely free movement */}
                  {S.logoFile && (
                    <LogoGraphic
                      url={logoURL}
                      type={
                        /\.svg$/i.test(S.logoFile?.name || '')
                          ? 'svg'
                          : 'raster'
                      }
                      baseWidth={S.logoBaseWidth || logoDefaultWidth}
                      transform={S.logoTransform}
                      setTransform={(t) => set({ logoTransform: t })}
                      gizmoMode={S.logoGizmoMode}
                      controlsEnabled={S.activeTool === 'logo'}
                      snapStep={S.snapEnabled ? S.snapStep : 0}
                    />
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

/* ------------------------------------------------------------------ */
/* Small UI bits                                                       */
/* ------------------------------------------------------------------ */

function Btn({ children, onClick, active }) {
  return (
    <button
      onClick={onClick}
      className={`p-3 rounded-lg border transition-all ${
        active
          ? 'bg-blue-500 border-blue-400 text-white shadow-lg'
          : 'bg-neutral-800 border-neutral-700 hover:bg-neutral-750'
      }`}
    >
      {children}
    </button>
  );
}
function Range({ label, min, max, step, value, onChange }) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{label}</label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-2 bg-neutral-800 rounded-lg appearance-none cursor-pointer"
      />
    </div>
  );
}
function Color({ label, value, onChange }) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{label}</label>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-12 rounded-lg border border-neutral-700 bg-neutral-800 cursor-pointer"
      />
    </div>
  );
}
function Nudge({ label, onNudge, step, setStep }) {
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
