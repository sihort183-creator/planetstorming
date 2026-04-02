import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Download, FolderOpen, GitBranch, Minus, MoveRight, PanelLeftClose, PanelLeftOpen, Plus, Slash } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';

interface PlanetData {
  id: string;
  x: number;
  y: number;
  text: string;
  size: number;
  orbitTargetId: string | null;
  orbitRadius: number;
  orbitAngle: number;
  color: string;
}

interface BlackHoleData {
  id: string;
  x: number;
  y: number;
}

type ConnectionType = 'line' | 'arrow';

interface ConnectionData {
  id: string;
  fromId: string;
  toId: string;
  type: ConnectionType;
}

interface CanvasDocument {
  version: 1;
  exportedAt: string;
  planets: PlanetData[];
  blackHoles: BlackHoleData[];
  connections?: ConnectionData[];
  isPlaying: boolean;
}

interface CanvasSnapshot {
  planets: PlanetData[];
  blackHoles: BlackHoleData[];
  connections: ConnectionData[];
  isPlaying: boolean;
}

const PLANET_COLORS = [
  'hsl(220, 20%, 50%)',
  'hsl(160, 25%, 45%)',
  'hsl(30, 35%, 50%)',
  'hsl(340, 20%, 50%)',
  'hsl(260, 20%, 55%)',
  'hsl(190, 25%, 45%)',
  'hsl(10, 30%, 50%)',
  'hsl(280, 15%, 50%)',
];

const ORBIT_PROXIMITY = 130;
const ORBIT_SPEED = 0.002;
const CANVAS_WIDTH = 3200;
const CANVAS_HEIGHT = 2200;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 1.8;
const ZOOM_STEP = 0.1;
const HISTORY_LIMIT = 100;

let nextId = 1;
const genId = () => `p-${nextId++}`;
let nextBhId = 1;
const genBhId = () => `bh-${nextBhId++}`;
let nextConnectionId = 1;
const genConnectionId = () => `c-${nextConnectionId++}`;

const isPlanetData = (value: unknown): value is PlanetData => {
  if (!value || typeof value !== 'object') return false;
  const planet = value as Record<string, unknown>;

  return (
    typeof planet.id === 'string' &&
    typeof planet.x === 'number' &&
    typeof planet.y === 'number' &&
    typeof planet.text === 'string' &&
    typeof planet.size === 'number' &&
    (typeof planet.orbitTargetId === 'string' || planet.orbitTargetId === null) &&
    typeof planet.orbitRadius === 'number' &&
    typeof planet.orbitAngle === 'number' &&
    typeof planet.color === 'string'
  );
};

const isBlackHoleData = (value: unknown): value is BlackHoleData => {
  if (!value || typeof value !== 'object') return false;
  const blackHole = value as Record<string, unknown>;

  return (
    typeof blackHole.id === 'string' &&
    typeof blackHole.x === 'number' &&
    typeof blackHole.y === 'number'
  );
};

const isCanvasDocument = (value: unknown): value is CanvasDocument => {
  if (!value || typeof value !== 'object') return false;
  const document = value as Record<string, unknown>;

  return (
    document.version === 1 &&
    Array.isArray(document.planets) &&
    document.planets.every(isPlanetData) &&
    Array.isArray(document.blackHoles) &&
    document.blackHoles.every(isBlackHoleData) &&
    (
      document.connections === undefined ||
      (
        Array.isArray(document.connections) &&
        document.connections.every(connection => {
          if (!connection || typeof connection !== 'object') return false;
          const item = connection as Record<string, unknown>;
          return (
            typeof item.id === 'string' &&
            typeof item.fromId === 'string' &&
            typeof item.toId === 'string' &&
            (item.type === 'line' || item.type === 'arrow')
          );
        })
      )
    ) &&
    typeof document.isPlaying === 'boolean'
  );
};

const syncIdCounters = (planets: PlanetData[], blackHoles: BlackHoleData[], connections: ConnectionData[]) => {
  const maxPlanetId = planets.reduce((max, planet) => {
    const numeric = Number.parseInt(planet.id.replace(/^p-/, ''), 10);
    return Number.isFinite(numeric) ? Math.max(max, numeric) : max;
  }, 0);

  const maxBlackHoleId = blackHoles.reduce((max, blackHole) => {
    const numeric = Number.parseInt(blackHole.id.replace(/^bh-/, ''), 10);
    return Number.isFinite(numeric) ? Math.max(max, numeric) : max;
  }, 0);

  const maxConnectionId = connections.reduce((max, connection) => {
    const numeric = Number.parseInt(connection.id.replace(/^c-/, ''), 10);
    return Number.isFinite(numeric) ? Math.max(max, numeric) : max;
  }, 0);

  nextId = maxPlanetId + 1;
  nextBhId = maxBlackHoleId + 1;
  nextConnectionId = maxConnectionId + 1;
};

export default function BrainstormCanvas() {
  const [planets, setPlanets] = useState<PlanetData[]>([]);
  const [blackHoles, setBlackHoles] = useState<BlackHoleData[]>([]);
  const [connections, setConnections] = useState<ConnectionData[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isFilePanelOpen, setIsFilePanelOpen] = useState(true);
  const [isConnectionPanelOpen, setIsConnectionPanelOpen] = useState(true);
  const [isConnectionMode, setIsConnectionMode] = useState(false);
  const [connectionType, setConnectionType] = useState<ConnectionType>('line');
  const [connectionStartId, setConnectionStartId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [marquee, setMarquee] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);

  const planetsRef = useRef(planets);
  const blackHolesRef = useRef(blackHoles);
  const connectionsRef = useRef(connections);
  const isPlayingRef = useRef(isPlaying);
  const selectedIdsRef = useRef(selectedIds);
  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const groupDragRef = useRef<{ offsets: Record<string, { dx: number; dy: number }>; bhOffsets: Record<string, { dx: number; dy: number }> } | null>(null);
  const resizeRef = useRef<{ id: string; startSize: number; startY: number } | null>(null);
  const orbitResizeRef = useRef<{ id: string; targetId: string; angle: number } | null>(null);
  const orbitPreviewRef = useRef<{
    targetId: string;
    radius: number;
    targetX: number;
    targetY: number;
    x?: number;
    y?: number;
    mode?: 'new-orbit' | 'existing-orbit';
  } | null>(null);
  const marqueeRef = useRef<{ startX: number; startY: number } | null>(null);
  const historyRef = useRef<CanvasSnapshot[]>([]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [, forceRender] = useState(0);
  const dotCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => { planetsRef.current = planets; }, [planets]);
  useEffect(() => { blackHolesRef.current = blackHoles; }, [blackHoles]);
  useEffect(() => { connectionsRef.current = connections; }, [connections]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { selectedIdsRef.current = selectedIds; }, [selectedIds]);

  const createSnapshot = useCallback((): CanvasSnapshot => ({
    planets: planetsRef.current.map(planet => ({ ...planet })),
    blackHoles: blackHolesRef.current.map(blackHole => ({ ...blackHole })),
    connections: connectionsRef.current.map(connection => ({ ...connection })),
    isPlaying: isPlayingRef.current,
  }), []);

  const pushHistorySnapshot = useCallback(() => {
    historyRef.current = [...historyRef.current.slice(-(HISTORY_LIMIT - 1)), createSnapshot()];
  }, [createSnapshot]);

  const restoreSnapshot = useCallback((snapshot: CanvasSnapshot) => {
    syncIdCounters(snapshot.planets, snapshot.blackHoles, snapshot.connections);
    setPlanets(snapshot.planets.map(planet => ({ ...planet })));
    setBlackHoles(snapshot.blackHoles.map(blackHole => ({ ...blackHole })));
    setConnections(snapshot.connections.map(connection => ({ ...connection })));
    setIsPlaying(snapshot.isPlaying);
    setSelectedIds(new Set());
    setSelectedConnectionIds(new Set());
    setEditingId(null);
    setConnectionStartId(null);
    orbitPreviewRef.current = null;
    dragRef.current = null;
    groupDragRef.current = null;
    resizeRef.current = null;
    orbitResizeRef.current = null;
    marqueeRef.current = null;
    setMarquee(null);
  }, []);

  const getCanvasPoint = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current!.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / zoom,
      y: (clientY - rect.top) / zoom,
    };
  }, [zoom]);

  const centerViewport = useCallback((nextZoom = zoom) => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    viewport.scrollLeft = Math.max(0, (CANVAS_WIDTH * nextZoom - viewport.clientWidth) / 2);
    viewport.scrollTop = Math.max(0, (CANVAS_HEIGHT * nextZoom - viewport.clientHeight) / 2);
  }, [zoom]);

  const handleZoomChange = useCallback((delta: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number((zoom + delta).toFixed(2))));
    if (nextZoom === zoom) return;

    const centerX = viewport.scrollLeft + viewport.clientWidth / 2;
    const centerY = viewport.scrollTop + viewport.clientHeight / 2;
    const logicalCenterX = centerX / zoom;
    const logicalCenterY = centerY / zoom;

    setZoom(nextZoom);

    requestAnimationFrame(() => {
      const nextViewport = viewportRef.current;
      if (!nextViewport) return;

      nextViewport.scrollLeft = Math.max(0, logicalCenterX * nextZoom - nextViewport.clientWidth / 2);
      nextViewport.scrollTop = Math.max(0, logicalCenterY * nextZoom - nextViewport.clientHeight / 2);
    });
  }, [zoom]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => centerViewport(1));
    return () => cancelAnimationFrame(frame);
  }, [centerViewport]);

  const handleSaveToFile = useCallback(() => {
    const document: CanvasDocument = {
      version: 1,
      exportedAt: new Date().toISOString(),
      planets: planetsRef.current,
      blackHoles: blackHolesRef.current,
      connections: connectionsRef.current,
      isPlaying: isPlayingRef.current,
    };

    const blob = new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    anchor.href = url;
    anchor.download = `orbit-canvas-${timestamp}.orbit.json`;
    anchor.click();

    URL.revokeObjectURL(url);

    toast({
      title: '파일 저장 완료',
      description: '현재 캔버스를 로컬 파일로 저장했습니다.',
    });
  }, []);

  const handleLoadFromFile = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));

        if (!isCanvasDocument(parsed)) {
          throw new Error('invalid-document');
        }

        const nextConnections = parsed.connections ?? [];

        pushHistorySnapshot();
        syncIdCounters(parsed.planets, parsed.blackHoles, nextConnections);
        setPlanets(parsed.planets);
        setBlackHoles(parsed.blackHoles);
        setConnections(nextConnections);
        setIsPlaying(parsed.isPlaying);
        setSelectedIds(new Set());
        setEditingId(null);
        setConnectionStartId(null);
        orbitPreviewRef.current = null;
        dragRef.current = null;
        groupDragRef.current = null;
        resizeRef.current = null;
        orbitResizeRef.current = null;
        marqueeRef.current = null;
        setMarquee(null);

        toast({
          title: '파일 불러오기 완료',
          description: `${file.name} 파일을 캔버스에 적용했습니다.`,
        });
      } catch {
        toast({
          title: '불러오기 실패',
          description: '지원하지 않는 파일 형식이거나 내용이 올바르지 않습니다.',
          variant: 'destructive',
        });
      } finally {
        input.value = '';
      }
    };

    reader.onerror = () => {
      toast({
        title: '파일 읽기 실패',
        description: '파일을 읽는 중 오류가 발생했습니다.',
        variant: 'destructive',
      });
      input.value = '';
    };

    reader.readAsText(file, 'utf-8');
  }, [pushHistorySnapshot]);

  const handlePlanetClick = useCallback((planetId: string) => {
    setSelectedConnectionIds(new Set());

    if (!isConnectionMode) return;

    if (!connectionStartId) {
      setConnectionStartId(planetId);
      return;
    }

    if (connectionStartId === planetId) {
      setConnectionStartId(null);
      return;
    }

    setConnections(prev => {
      const exists = prev.some(connection =>
        connection.fromId === connectionStartId &&
        connection.toId === planetId &&
        connection.type === connectionType
      );

      if (exists) return prev;

      pushHistorySnapshot();

      return [
        ...prev,
        {
          id: genConnectionId(),
          fromId: connectionStartId,
          toId: planetId,
          type: connectionType,
        },
      ];
    });

    setConnectionStartId(null);
  }, [connectionStartId, connectionType, isConnectionMode, pushHistorySnapshot]);

  const handleClearConnections = useCallback(() => {
    if (connectionsRef.current.length === 0) return;
    pushHistorySnapshot();
    setConnections([]);
    setConnectionStartId(null);
    setSelectedConnectionIds(new Set());
  }, [pushHistorySnapshot]);

  const getPos = useCallback((id: string, ps: PlanetData[], bhs: BlackHoleData[], visited = new Set<string>()): { x: number; y: number } => {
    if (visited.has(id)) return { x: 0, y: 0 };
    visited.add(id);
    const p = ps.find(p => p.id === id);
    if (p) {
      if (p.orbitTargetId) {
        const t = getPos(p.orbitTargetId, ps, bhs, visited);
        return {
          x: t.x + p.orbitRadius * Math.cos(p.orbitAngle),
          y: t.y + p.orbitRadius * Math.sin(p.orbitAngle),
        };
      }
      return { x: p.x, y: p.y };
    }
    const bh = bhs.find(b => b.id === id);
    if (bh) return { x: bh.x, y: bh.y };
    return { x: 0, y: 0 };
  }, []);

  // Collect all orbiter descendants of a set of IDs
  const collectOrbiters = useCallback((rootIds: Set<string>, ps: PlanetData[]): Set<string> => {
    const all = new Set(rootIds);
    let added = true;
    while (added) {
      added = false;
      for (const p of ps) {
        if (!all.has(p.id) && p.orbitTargetId && all.has(p.orbitTargetId)) {
          all.add(p.id);
          added = true;
        }
      }
    }
    return all;
  }, []);

  // Animation loop
  useEffect(() => {
    let animId: number;
    const animate = () => {
      if (isPlayingRef.current) {
        setPlanets(prev => {
          let changed = false;
          const next = prev.map(p => {
            if (p.orbitTargetId) {
              changed = true;
              const speed = ORBIT_SPEED * (60 / Math.max(p.orbitRadius, 30));
              return { ...p, orbitAngle: p.orbitAngle + speed };
            }
            return p;
          });
          return changed ? next : prev;
        });
      }
      animId = requestAnimationFrame(animate);
    };
    animId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animId);
  }, []);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.planet-el')) return;
    const { x, y } = getCanvasPoint(e.clientX, e.clientY);
    const color = PLANET_COLORS[(nextId - 1) % PLANET_COLORS.length];
    const id = genId();
    const newPlanet: PlanetData = {
      id, x, y, text: '', size: 55,
      orbitTargetId: null, orbitRadius: 0, orbitAngle: 0, color,
    };
    pushHistorySnapshot();
    setPlanets(prev => [...prev, newPlanet]);
    setSelectedIds(new Set([id]));
    setEditingId(id);
  }, [getCanvasPoint, pushHistorySnapshot]);

  const handlePlanetMouseDown = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    e.preventDefault();
    if (editingId === id) return;
    if (isConnectionMode) return;

    const ps = planetsRef.current;
    const bhs = blackHolesRef.current;
    const currentSelected = selectedIdsRef.current;

    setSelectedConnectionIds(new Set());

    // If clicking a planet that's part of a multi-selection, do group drag
    if (currentSelected.size > 1 && currentSelected.has(id)) {
      pushHistorySnapshot();
      const { x: mouseX, y: mouseY } = getCanvasPoint(e.clientX, e.clientY);

      // Collect all planets in the group (selected + their orbiter descendants)
      const groupIds = collectOrbiters(currentSelected, ps);
      // Also find black holes that are orbit targets within the group
      const relatedBhIds = new Set<string>();
      for (const p of ps) {
        if (groupIds.has(p.id) && p.orbitTargetId && !groupIds.has(p.orbitTargetId)) {
          const bh = bhs.find(b => b.id === p.orbitTargetId);
          if (bh) relatedBhIds.add(bh.id);
        }
      }
      // Also include black holes that are orbited by group members
      for (const bh of bhs) {
        const hasOrbiter = ps.some(p => p.orbitTargetId === bh.id && groupIds.has(p.id));
        if (hasOrbiter) relatedBhIds.add(bh.id);
      }

      const offsets: Record<string, { dx: number; dy: number }> = {};
      for (const pid of groupIds) {
        const p = ps.find(pp => pp.id === pid);
        if (p && !p.orbitTargetId) {
          offsets[pid] = { dx: p.x - mouseX, dy: p.y - mouseY };
        }
      }
      const bhOffsets: Record<string, { dx: number; dy: number }> = {};
      for (const bhId of relatedBhIds) {
        const bh = bhs.find(b => b.id === bhId);
        if (bh) {
          bhOffsets[bhId] = { dx: bh.x - mouseX, dy: bh.y - mouseY };
        }
      }

      groupDragRef.current = { offsets, bhOffsets };
      dragRef.current = { id, offsetX: 0, offsetY: 0 }; // sentinel to indicate dragging
      return;
    }

    // Single planet drag
    setSelectedIds(new Set([id]));

    const planet = ps.find(p => p.id === id)!;
    const pos = getPos(id, ps, bhs);

    if (planet.orbitTargetId) {
      pushHistorySnapshot();
      setPlanets(prev => prev.map(p =>
        p.id === id ? { ...p, x: pos.x, y: pos.y, orbitTargetId: null, orbitRadius: 0, orbitAngle: 0 } : p
      ));
    }

    const { x: mouseX, y: mouseY } = getCanvasPoint(e.clientX, e.clientY);
    dragRef.current = {
      id,
      offsetX: mouseX - pos.x,
      offsetY: mouseY - pos.y,
    };
    groupDragRef.current = null;
  }, [collectOrbiters, editingId, getCanvasPoint, getPos, isConnectionMode, pushHistorySnapshot]);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    e.preventDefault();
    const planet = planetsRef.current.find(p => p.id === id);
    if (!planet) return;
    pushHistorySnapshot();
    resizeRef.current = { id, startSize: planet.size, startY: e.clientY };
  }, [pushHistorySnapshot]);

  const handleOrbitResizeMouseDown = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    e.preventDefault();

    const planet = planetsRef.current.find(p => p.id === id);
    if (!planet?.orbitTargetId) return;

    pushHistorySnapshot();
    orbitResizeRef.current = {
      id,
      targetId: planet.orbitTargetId,
      angle: planet.orbitAngle,
    };
  }, [pushHistorySnapshot]);

  // Marquee start on canvas mousedown
  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    if (isConnectionMode) return;
    if (
      (e.target as HTMLElement).closest('.planet-el') ||
      (e.target as HTMLElement).closest('.control-btn') ||
      (e.target as HTMLElement).closest('.orbit-resize-hitbox') ||
      (e.target as HTMLElement).closest('.orbit-resize-handle')
    ) return;
    const { x, y } = getCanvasPoint(e.clientX, e.clientY);
    marqueeRef.current = { startX: x, startY: y };
    setMarquee({ startX: x, startY: y, endX: x, endY: y });
  }, [getCanvasPoint, isConnectionMode]);

  // Global mouse handlers
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      // Marquee selection
      if (marqueeRef.current && !dragRef.current) {
        const { x, y } = getCanvasPoint(e.clientX, e.clientY);
        setMarquee({ startX: marqueeRef.current.startX, startY: marqueeRef.current.startY, endX: x, endY: y });
        return;
      }

      // Group drag
      if (dragRef.current && groupDragRef.current) {
        const { x: mouseX, y: mouseY } = getCanvasPoint(e.clientX, e.clientY);
        const { offsets, bhOffsets } = groupDragRef.current;

        setPlanets(prev => prev.map(p => {
          if (offsets[p.id]) {
            return { ...p, x: mouseX + offsets[p.id].dx, y: mouseY + offsets[p.id].dy };
          }
          return p;
        }));

        if (Object.keys(bhOffsets).length > 0) {
          setBlackHoles(prev => prev.map(bh => {
            if (bhOffsets[bh.id]) {
              return { ...bh, x: mouseX + bhOffsets[bh.id].dx, y: mouseY + bhOffsets[bh.id].dy };
            }
            return bh;
          }));
        }

        forceRender(n => n + 1);
        return;
      }

      // Single drag
      if (dragRef.current) {
        const { x: mouseX, y: mouseY } = getCanvasPoint(e.clientX, e.clientY);
        const newX = mouseX - dragRef.current.offsetX;
        const newY = mouseY - dragRef.current.offsetY;
        const dragId = dragRef.current.id;
        const blockedTargetIds = collectOrbiters(new Set([dragId]), planetsRef.current);

        setPlanets(prev => prev.map(p =>
          p.id === dragId ? { ...p, x: newX, y: newY } : p
        ));

        // Check proximity for orbit
        const ps = planetsRef.current;
        const bhs = blackHolesRef.current;
        let closest: { id: string; x: number; y: number; dist: number; previewX?: number; previewY?: number } | null = null;

        for (const p of ps) {
          if (p.id === dragId) continue;
          if (blockedTargetIds.has(p.id)) continue;
          const pos = getPos(p.id, ps, bhs);
          const dist = Math.hypot(newX - pos.x, newY - pos.y);
          if (dist < ORBIT_PROXIMITY + p.size && (!closest || dist < closest.dist)) {
            closest = { id: p.id, x: pos.x, y: pos.y, dist };
          }
        }

        for (const orbitPlanet of ps) {
          if (!orbitPlanet.orbitTargetId) continue;
          if (orbitPlanet.id === dragId) continue;
          if (blockedTargetIds.has(orbitPlanet.orbitTargetId)) continue;

          const center = displayPos[orbitPlanet.orbitTargetId];
          if (!center) continue;

          const distanceFromCenter = Math.hypot(newX - center.x, newY - center.y);
          const distanceToOrbit = Math.abs(distanceFromCenter - orbitPlanet.orbitRadius);

          if (distanceToOrbit < 16 && (!closest || distanceToOrbit < closest.dist)) {
            const angle = Math.atan2(newY - center.y, newX - center.x);
            closest = {
              id: orbitPlanet.orbitTargetId,
              x: center.x,
              y: center.y,
              dist: distanceToOrbit,
              previewX: center.x + orbitPlanet.orbitRadius * Math.cos(angle),
              previewY: center.y + orbitPlanet.orbitRadius * Math.sin(angle),
            };
          }
        }

        for (const bh of bhs) {
          const dist = Math.hypot(newX - bh.x, newY - bh.y);
          if (dist < ORBIT_PROXIMITY && (!closest || dist < closest.dist)) {
            closest = { id: bh.id, x: bh.x, y: bh.y, dist };
          }
        }

        if (closest) {
          if (closest.previewX !== undefined && closest.previewY !== undefined) {
            const radius = Math.hypot(closest.previewX - closest.x, closest.previewY - closest.y);
            setPlanets(prev => prev.map(p =>
              p.id === dragId ? { ...p, x: closest.previewX!, y: closest.previewY! } : p
            ));
            orbitPreviewRef.current = {
              targetId: closest.id,
              radius,
              targetX: closest.x,
              targetY: closest.y,
              x: closest.previewX,
              y: closest.previewY,
              mode: 'existing-orbit',
            };
          } else {
            orbitPreviewRef.current = {
              targetId: closest.id,
              radius: closest.dist,
              targetX: closest.x,
              targetY: closest.y,
              mode: 'new-orbit',
            };
          }
        } else {
          orbitPreviewRef.current = null;
        }
        forceRender(n => n + 1);
      }

      if (resizeRef.current) {
        const delta = resizeRef.current.startY - e.clientY;
        const newSize = Math.max(30, Math.min(200, resizeRef.current.startSize + delta));
        const resId = resizeRef.current.id;
        setPlanets(prev => prev.map(p =>
          p.id === resId ? { ...p, size: newSize } : p
        ));
      }

      if (orbitResizeRef.current) {
        const { x: mouseX, y: mouseY } = getCanvasPoint(e.clientX, e.clientY);
        const { id, targetId, angle } = orbitResizeRef.current;
        const targetPos = displayPos[targetId];
        if (!targetPos) return;

        const nextRadius = Math.max(24, Math.hypot(mouseX - targetPos.x, mouseY - targetPos.y));

        setPlanets(prev => prev.map(p =>
          p.id === id
            ? {
                ...p,
                orbitRadius: nextRadius,
                x: targetPos.x + nextRadius * Math.cos(angle),
                y: targetPos.y + nextRadius * Math.sin(angle),
              }
            : p
        ));
        forceRender(n => n + 1);
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      // Marquee selection complete
      if (marqueeRef.current && !dragRef.current) {
        const { x: endX, y: endY } = getCanvasPoint(e.clientX, e.clientY);
        const { startX, startY } = marqueeRef.current;

        const left = Math.min(startX, endX);
        const right = Math.max(startX, endX);
        const top = Math.min(startY, endY);
        const bottom = Math.max(startY, endY);

        // Only select if marquee is big enough (not just a click)
        if (right - left > 5 || bottom - top > 5) {
          const ps = planetsRef.current;
          const bhs = blackHolesRef.current;
          const hitIds = new Set<string>();

          for (const p of ps) {
            const pos = getPos(p.id, ps, bhs);
            if (pos.x >= left && pos.x <= right && pos.y >= top && pos.y <= bottom) {
              hitIds.add(p.id);
            }
          }

          if (hitIds.size > 0) {
            // Also collect all orbiter descendants
            const allIds = collectOrbiters(hitIds, ps);
            setSelectedIds(allIds);
            setSelectedConnectionIds(new Set());
          } else {
            setSelectedIds(new Set());
            setSelectedConnectionIds(new Set());
          }
        } else {
          setSelectedIds(new Set());
          setSelectedConnectionIds(new Set());
          setEditingId(null);
        }

        marqueeRef.current = null;
        setMarquee(null);
        return;
      }

      // Group drag end
      if (dragRef.current && groupDragRef.current) {
        dragRef.current = null;
        groupDragRef.current = null;
        forceRender(n => n + 1);
        return;
      }

      // Single drag end with orbit
      if (dragRef.current && orbitPreviewRef.current) {
        const dragId = dragRef.current.id;
        const preview = orbitPreviewRef.current;
        const targetBh = blackHolesRef.current.find(b => b.id === preview.targetId);

        if (targetBh) {
          setPlanets(prev => prev.map(p => {
            if (p.id === dragId) return { ...p, x: targetBh.x, y: targetBh.y, orbitTargetId: null, orbitRadius: 0, orbitAngle: 0 };
            if (p.orbitTargetId === targetBh.id) return { ...p, orbitTargetId: dragId };
            return p;
          }));
          setBlackHoles(prev => prev.filter(b => b.id !== targetBh.id));
        } else {
          const draggedPlanet = planetsRef.current.find(p => p.id === dragId);
          if (draggedPlanet) {
            const angle = Math.atan2(
              (preview.y ?? draggedPlanet.y) - preview.targetY,
              (preview.x ?? draggedPlanet.x) - preview.targetX
            );
            setPlanets(prev => prev.map(p =>
              p.id === dragId
                ? {
                    ...p,
                    x: preview.x ?? p.x,
                    y: preview.y ?? p.y,
                    orbitTargetId: preview.targetId,
                    orbitRadius: preview.radius,
                    orbitAngle: angle,
                  }
                : p
            ));
          }
        }
        orbitPreviewRef.current = null;
      }
      dragRef.current = null;
      groupDragRef.current = null;
      resizeRef.current = null;
      orbitResizeRef.current = null;
      forceRender(n => n + 1);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [collectOrbiters, displayPos, getCanvasPoint, getPos]);

  // Keyboard
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (editingId) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        const previousSnapshot = historyRef.current[historyRef.current.length - 1];
        if (!previousSnapshot) return;

        historyRef.current = historyRef.current.slice(0, -1);
        restoreSnapshot(previousSnapshot);
        return;
      }

      if (selectedIds.size === 0 && selectedConnectionIds.size === 0) return;

      if (e.key === 'Backspace') {
        if (selectedIds.size === 0) return;
        e.preventDefault();
        pushHistorySnapshot();
        const ps = planetsRef.current;
        const bhs = blackHolesRef.current;

        for (const sid of selectedIds) {
          const planet = ps.find(p => p.id === sid);
          if (!planet) continue;

          const orbiters = ps.filter(p => p.orbitTargetId === sid);

          if (planet.orbitTargetId) {
            const pos = getPos(sid, ps, bhs);
            setPlanets(prev => prev.map(p =>
              p.id === sid ? { ...p, x: pos.x, y: pos.y, orbitTargetId: null, orbitRadius: 0, orbitAngle: 0 } : p
            ));
          } else if (orbiters.length > 0) {
            const pos = getPos(sid, ps, bhs);
            const bhId = genBhId();
            setPlanets(prev =>
              prev.map(p => {
                if (p.id === sid) {
                  return { ...p, orbitTargetId: null, orbitRadius: 0, orbitAngle: 0, x: pos.x, y: pos.y };
                }
                if (p.orbitTargetId === sid) {
                  return { ...p, orbitTargetId: bhId };
                }
                return p;
              })
            );
            setBlackHoles(prev => [...prev, { id: bhId, x: pos.x, y: pos.y }]);
          }
        }
      }

      if (e.key === 'Delete') {
        e.preventDefault();
        pushHistorySnapshot();
        const ps = planetsRef.current;
        const bhs = blackHolesRef.current;
        const idsToDelete = new Set(selectedIds);
        const connectionIdsToDelete = new Set(selectedConnectionIds);

        for (const sid of selectedIds) {
          const planet = ps.find(p => p.id === sid);
          if (!planet) continue;

          const orbiters = ps.filter(p => p.orbitTargetId === sid);

          if (planet.orbitTargetId) {
            const pos = getPos(sid, ps, bhs);
            setPlanets(prev => prev.map(p =>
              p.id === sid ? { ...p, x: pos.x, y: pos.y, orbitTargetId: null, orbitRadius: 0, orbitAngle: 0 } : p
            ));
          } else if (orbiters.length > 0) {
            const pos = getPos(sid, ps, bhs);
            const bhId = genBhId();
            setPlanets(prev =>
              prev.filter(p => p.id !== sid)
                .map(p => p.orbitTargetId === sid ? { ...p, orbitTargetId: bhId } : p)
            );
            setBlackHoles(prev => [...prev, { id: bhId, x: pos.x, y: pos.y }]);
          } else {
            setPlanets(prev => prev.filter(p => p.id !== sid));
          }
        }

        setConnections(prev => prev.filter(connection =>
          !idsToDelete.has(connection.fromId) &&
          !idsToDelete.has(connection.toId) &&
          !connectionIdsToDelete.has(connection.id)
        ));
        if (connectionStartId && idsToDelete.has(connectionStartId)) {
          setConnectionStartId(null);
        }
        setSelectedIds(new Set());
        setSelectedConnectionIds(new Set());
      }

      if (e.key === 'Escape' && isConnectionMode) {
        setConnectionStartId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [connectionStartId, editingId, getPos, isConnectionMode, pushHistorySnapshot, restoreSnapshot, selectedConnectionIds, selectedIds]);

  // Orbiter counts for distortion
  const orbiterCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    const count = (id: string): number => {
      const direct = planets.filter(p => p.orbitTargetId === id);
      return direct.reduce((sum, d) => sum + 1 + count(d.id), 0);
    };
    for (const p of planets) counts[p.id] = count(p.id);
    for (const bh of blackHoles) counts[bh.id] = count(bh.id);
    return counts;
  }, [planets, blackHoles]);

  // Display positions
  const displayPos = useMemo(() => {
    const pos: Record<string, { x: number; y: number }> = {};
    for (const p of planets) pos[p.id] = getPos(p.id, planets, blackHoles);
    for (const bh of blackHoles) pos[bh.id] = { x: bh.x, y: bh.y };
    return pos;
  }, [planets, blackHoles, getPos]);

  const getConnectionPoints = useCallback((connection: ConnectionData) => {
    const fromPlanet = planets.find(planet => planet.id === connection.fromId);
    const toPlanet = planets.find(planet => planet.id === connection.toId);
    const from = displayPos[connection.fromId];
    const to = displayPos[connection.toId];

    if (!fromPlanet || !toPlanet || !from || !to) return null;

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.hypot(dx, dy);

    if (distance < 1) {
      return { x1: from.x, y1: from.y, x2: to.x, y2: to.y };
    }

    const ux = dx / distance;
    const uy = dy / distance;

    return {
      x1: from.x + ux * fromPlanet.size,
      y1: from.y + uy * fromPlanet.size,
      x2: to.x - ux * toPlanet.size,
      y2: to.y - uy * toPlanet.size,
    };
  }, [displayPos, planets]);

  // Draw warped dot grid on canvas
  useEffect(() => {
    const canvas = dotCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = CANVAS_WIDTH;
    const h = CANVAS_HEIGHT;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const spacing = 28;
    const dotColor = 'hsl(0, 0%, 82%)';

    // Build gravity wells: entities with orbiters
    const wells: { x: number; y: number; strength: number }[] = [];
    for (const [id, count] of Object.entries(orbiterCounts)) {
      if (count <= 0) continue;
      const pos = displayPos[id];
      if (!pos) continue;
      wells.push({ x: pos.x, y: pos.y, strength: count });
    }

    for (let gx = 0; gx < w + spacing; gx += spacing) {
      for (let gy = 0; gy < h + spacing; gy += spacing) {
        let dx = 0, dy = 0;

        for (const well of wells) {
          const wx = well.x - gx;
          const wy = well.y - gy;
          const dist = Math.sqrt(wx * wx + wy * wy);
          if (dist < 1) continue;
          const pullRadius = 80 + well.strength * 40;
          if (dist > pullRadius) continue;
          const factor = well.strength * 18 * Math.pow(1 - dist / pullRadius, 2);
          dx += (wx / dist) * factor;
          dy += (wy / dist) * factor;
        }

        ctx.beginPath();
        ctx.arc(gx + dx, gy + dy, 1, 0, Math.PI * 2);
        ctx.fillStyle = dotColor;
        ctx.fill();
      }
    }
  }, [displayPos, orbiterCounts]);

  const preview = orbitPreviewRef.current;

  // Marquee rect for rendering
  const marqueeRect = marquee ? {
    left: Math.min(marquee.startX, marquee.endX),
    top: Math.min(marquee.startY, marquee.endY),
    width: Math.abs(marquee.endX - marquee.startX),
    height: Math.abs(marquee.endY - marquee.startY),
  } : null;

  return (
    <div ref={viewportRef} className="brainstorm-viewport">
      <div className="side-panels" style={{ zIndex: 60 }}>
      <div className={`file-panel ${isFilePanelOpen ? 'open' : 'collapsed'}`}>
        <button
          type="button"
          className="file-panel-tab"
          onClick={() => setIsFilePanelOpen(prev => !prev)}
          aria-label={isFilePanelOpen ? '파일 패널 닫기' : '파일 패널 열기'}
        >
          {isFilePanelOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          <span>파일</span>
        </button>

        {isFilePanelOpen && (
          <div className="file-panel-body">
            <div className="file-panel-title">캔버스 파일</div>
            <p className="file-panel-description">
              현재 상태를 JSON 파일로 저장하거나, 이전에 저장한 파일을 다시 불러올 수 있습니다.
            </p>

            <div className="file-panel-actions">
              <Button type="button" variant="outline" className="w-full justify-start gap-2" onClick={handleSaveToFile}>
                <Download size={16} />
                저장하기
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full justify-start gap-2"
                onClick={() => fileInputRef.current?.click()}
              >
                <FolderOpen size={16} />
                불러오기
              </Button>
            </div>

            <p className="file-panel-meta">지원 형식: `.orbit.json`</p>
          </div>
        )}
      </div>

      <div className={`file-panel ${isConnectionPanelOpen ? 'open' : 'collapsed'}`}>
        <button
          type="button"
          className="file-panel-tab"
          onClick={() => setIsConnectionPanelOpen(prev => !prev)}
          aria-label={isConnectionPanelOpen ? '연결 패널 닫기' : '연결 패널 열기'}
        >
          {isConnectionPanelOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          <span>연결</span>
        </button>

        {isConnectionPanelOpen && (
          <div className="file-panel-body">
            <div className="file-panel-title">행성 연결</div>
            <p className="file-panel-description">
              연결 모드를 켠 뒤 행성 두 개를 순서대로 클릭하면 선을 만들 수 있습니다.
            </p>

            <div className="file-panel-actions">
              <Button
                type="button"
                variant={isConnectionMode ? 'default' : 'outline'}
                className="w-full justify-start gap-2"
                onClick={() => {
                  setIsConnectionMode(prev => !prev);
                  setConnectionStartId(null);
                }}
              >
                <GitBranch size={16} />
                {isConnectionMode ? '연결 모드 끄기' : '연결 모드 켜기'}
              </Button>

              <div className="connection-type-row">
                <Button
                  type="button"
                  variant={connectionType === 'line' ? 'default' : 'outline'}
                  className="flex-1 gap-2"
                  onClick={() => setConnectionType('line')}
                >
                  <Slash size={16} />
                  일반 선
                </Button>
                <Button
                  type="button"
                  variant={connectionType === 'arrow' ? 'default' : 'outline'}
                  className="flex-1 gap-2"
                  onClick={() => setConnectionType('arrow')}
                >
                  <MoveRight size={16} />
                  화살표
                </Button>
              </div>

              <Button
                type="button"
                variant="outline"
                className="w-full justify-start gap-2"
                onClick={handleClearConnections}
              >
                <Slash size={16} />
                선 전체 삭제
              </Button>
            </div>

            <p className="file-panel-meta">
              {connectionStartId ? '두 번째 행성을 클릭해 연결을 완료하세요.' : '연결 모드에서 첫 번째 행성을 선택하세요.'}
            </p>
          </div>
        )}
      </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.orbit.json,application/json"
        className="hidden"
        onChange={handleLoadFromFile}
      />

      <div className="brainstorm-stage" style={{ width: CANVAS_WIDTH * zoom, height: CANVAS_HEIGHT * zoom }}>
      <div
        ref={containerRef}
        className="brainstorm-canvas"
        style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT, transform: `scale(${zoom})` }}
        onDoubleClick={handleDoubleClick}
        onMouseDown={handleCanvasMouseDown}
        onClick={(e) => {
          if (
            !(e.target as HTMLElement).closest('.planet-el') &&
            !(e.target as HTMLElement).closest('.connection-hitbox') &&
            !(e.target as HTMLElement).closest('.orbit-resize-hitbox') &&
            !(e.target as HTMLElement).closest('.orbit-resize-handle')
          ) {
            setSelectedIds(new Set());
            setSelectedConnectionIds(new Set());
          }
          if (isConnectionMode && !(e.target as HTMLElement).closest('.planet-el')) {
            setConnectionStartId(null);
          }
        }}
      >
      <canvas ref={dotCanvasRef} className="absolute inset-0 pointer-events-none" style={{ zIndex: 0 }} />
      <svg className="absolute inset-0 w-full h-full" style={{ zIndex: 1 }}>
        <defs>
          <marker
            id="orbit-arrowhead"
            markerWidth="7"
            markerHeight="7"
            refX="6"
            refY="3.5"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M 0 0 L 7 3.5 L 0 7 z" fill="hsl(220, 18%, 42%)" />
          </marker>
        </defs>

        {connections.map(connection => {
          const points = getConnectionPoints(connection);
          if (!points) return null;
          const isSelected = selectedConnectionIds.has(connection.id);

          return (
            <g key={connection.id}>
              <line
                x1={points.x1}
                y1={points.y1}
                x2={points.x2}
                y2={points.y2}
                stroke={isSelected ? 'hsl(215, 70%, 52%)' : 'hsl(220, 18%, 42%)'}
                strokeWidth={connection.type === 'arrow' ? (isSelected ? '2.1' : '1.4') : (isSelected ? '3' : '2')}
                opacity={0.95}
                markerEnd={connection.type === 'arrow' ? 'url(#orbit-arrowhead)' : undefined}
                pointerEvents="none"
              />
              <line
                className="connection-hitbox"
                x1={points.x1}
                y1={points.y1}
                x2={points.x2}
                y2={points.y2}
                stroke="transparent"
                strokeWidth="14"
                style={{ cursor: 'pointer' }}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedIds(new Set());
                  setSelectedConnectionIds(new Set([connection.id]));
                }}
              />
            </g>
          );
        })}

        {/* Orbit paths */}
        {planets.filter(p => p.orbitTargetId).map(p => {
          const tPos = displayPos[p.orbitTargetId!];
          if (!tPos) return null;
          const isSelectedOrbit = selectedIds.size === 1 && selectedIds.has(p.id);
          const handleX = tPos.x + p.orbitRadius * Math.cos(p.orbitAngle);
          const handleY = tPos.y + p.orbitRadius * Math.sin(p.orbitAngle);

          return (
            <g key={`orbit-${p.id}`}>
              {isSelectedOrbit && (
                <circle
                  className="orbit-resize-hitbox"
                  cx={tPos.x}
                  cy={tPos.y}
                  r={p.orbitRadius}
                  fill="none"
                  stroke="transparent"
                  strokeWidth="18"
                  style={{ cursor: 'ew-resize' }}
                  onMouseDown={(e) => handleOrbitResizeMouseDown(e, p.id)}
                />
              )}
              <circle
                cx={tPos.x}
                cy={tPos.y}
                r={p.orbitRadius}
                fill="none"
                stroke={isSelectedOrbit ? 'hsl(215, 72%, 56%)' : 'hsl(0, 0%, 78%)'}
                strokeWidth={isSelectedOrbit ? '1.8' : '1'}
                strokeDasharray="6 4"
                opacity={isSelectedOrbit ? 0.92 : 0.6}
                pointerEvents="none"
              />
              {isSelectedOrbit && (
                <circle
                  className="orbit-resize-handle"
                  cx={handleX}
                  cy={handleY}
                  r="7"
                  onMouseDown={(e) => handleOrbitResizeMouseDown(e, p.id)}
                />
              )}
            </g>
          );
        })}

        {/* Orbit preview */}
        {preview && (
          <>
            <circle
              cx={preview.targetX}
              cy={preview.targetY}
              r={preview.radius}
              fill="none"
              stroke={preview.mode === 'existing-orbit' ? 'hsl(42, 92%, 52%)' : 'hsl(220, 45%, 60%)'}
              strokeWidth={preview.mode === 'existing-orbit' ? '3' : '2'}
              strokeDasharray={preview.mode === 'existing-orbit' ? '10 5' : '8 4'}
              opacity={0.9}
              pointerEvents="none"
            />
            {preview.mode === 'existing-orbit' && preview.x !== undefined && preview.y !== undefined && (
              <circle
                cx={preview.x}
                cy={preview.y}
                r="10"
                fill="hsla(42, 92%, 52%, 0.18)"
                stroke="hsl(42, 92%, 45%)"
                strokeWidth="2"
                pointerEvents="none"
              />
            )}
          </>
        )}
      </svg>

      {/* Marquee selection rectangle */}
      {marqueeRect && marqueeRect.width > 2 && marqueeRect.height > 2 && (
        <div
          className="marquee-rect"
          style={{
            left: marqueeRect.left,
            top: marqueeRect.top,
            width: marqueeRect.width,
            height: marqueeRect.height,
          }}
        />
      )}

      {/* Black holes */}
      {blackHoles.map(bh => (
        <div
          key={bh.id}
          className="blackhole-el"
          style={{
            left: bh.x, top: bh.y,
            transform: 'translate(-50%, -50%)',
            zIndex: 2,
          }}
        >
          <div className="blackhole-core" />
          <div className="blackhole-ring ring-1" />
          <div className="blackhole-ring ring-2" />
          <div className="blackhole-ring ring-3" />
        </div>
      ))}

      {/* Planets */}
      {planets.map(p => {
        const pos = displayPos[p.id];
        if (!pos) return null;
        const isSelected = selectedIds.has(p.id);
        const isConnectionStart = connectionStartId === p.id;
        return (
          <div
            key={p.id}
            className={`planet-el ${isSelected ? 'selected' : ''} ${isConnectionStart ? 'connection-start' : ''}`}
            style={{
              left: pos.x, top: pos.y,
              width: p.size * 2, height: p.size * 2,
              borderColor: p.color,
              transform: 'translate(-50%, -50%)',
              zIndex: isSelected ? 10 : 3,
              cursor: isConnectionMode ? 'pointer' : undefined,
            }}
            onMouseDown={(e) => handlePlanetMouseDown(e, p.id)}
            onClick={(e) => {
              e.stopPropagation();
              handlePlanetClick(p.id);
            }}
            onDoubleClick={(e) => { e.stopPropagation(); setEditingId(p.id); }}
          >
            {editingId === p.id ? (
              <textarea
                className="planet-input"
                value={p.text}
                autoFocus
                onChange={(e) => {
                  const val = e.target.value;
                  setPlanets(prev => prev.map(pp => pp.id === p.id ? { ...pp, text: val } : pp));
                }}
                onBlur={() => setEditingId(null)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setEditingId(null);
                  e.stopPropagation();
                }}
                onMouseDown={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="planet-label">{p.text || '...'}</span>
            )}
            {isSelected && selectedIds.size === 1 && (
              <div
                className="resize-handle"
                onMouseDown={(e) => handleResizeMouseDown(e, p.id)}
              />
            )}
          </div>
        );
      })}
      </div>
      </div>

      {/* Controls */}
      <button
        className="control-btn"
        onClick={() => {
          pushHistorySnapshot();
          setIsPlaying(prev => !prev);
        }}
        title={isPlaying ? '일시정지' : '재생'}
      >
        {isPlaying ? '⏸' : '▶'}
      </button>

      <div className="zoom-controls">
        <button className="zoom-btn" onClick={() => handleZoomChange(-ZOOM_STEP)} title="축소">
          <Minus size={16} />
        </button>
        <button className="zoom-indicator" onClick={() => centerViewport()} title="중앙으로 이동">
          {Math.round(zoom * 100)}%
        </button>
        <button className="zoom-btn" onClick={() => handleZoomChange(ZOOM_STEP)} title="확대">
          <Plus size={16} />
        </button>
      </div>

      <div className="canvas-hint">
        더블클릭으로 행성 생성 · 드래그하여 범위 선택 · 다른 행성 근처에 놓으면 공전 · Backspace로 분리
      </div>
    </div>
  );
}
