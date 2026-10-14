import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Polygon, CircleMarker, useMapEvents, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { Undo2, Redo2, X, Trash2, Check, MapPin } from 'lucide-react';
import { validateRing, fromGeoJSON, toGeoJSON, bboxCenter, SAO_PAULO_CENTER } from '@/lib/deliveryGeo';

// Editor de polígono da área de entrega (clique adiciona vértice).
// Sem geocodificação aqui: só desenha, valida e devolve GeoJSON.
// Tiles OSM exigem rede; sem rede o mapa não carrega (limitação documentada).
const MAX_HISTORY = 50;

function ClickCatcher({ onAdd, disabled }) {
  useMapEvents({
    click(e) {
      if (disabled) return;
      onAdd({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

function FitToPath({ path }) {
  const map = useMap();
  useEffect(() => {
    if (path.length >= 3) {
      const lats = path.map((p) => p.lat);
      const lngs = path.map((p) => p.lng);
      map.fitBounds([[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]], { padding: [24, 24] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

export default function ZoneMapEditor({ initialGeo, zoneName, onSave, saving }) {
  const { toast } = useToast();
  const [path, setPath] = useState(() => fromGeoJSON(initialGeo));
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);
  const [selected, setSelected] = useState(null);
  const [closed, setClosed] = useState(() => fromGeoJSON(initialGeo).length >= 3);

  const push = (next) => {
    setPast((prev) => [...prev.slice(-MAX_HISTORY + 1), path]);
    setFuture([]);
    setPath(next);
    setSelected(null);
  };

  const center = path.length > 0 ? bboxCenter(path) : { ...SAO_PAULO_CENTER };

  const addVertex = (p) => {
    if (closed) {
      toast({ title: 'Região fechada', description: 'Reabra para continuar editando.' });
      return;
    }
    push([...path, p]);
  };

  const moveVertex = (idx, latlng) => {
    const next = path.map((p, i) => (i === idx ? { lat: latlng.lat, lng: latlng.lng } : p));
    push(next);
  };

  const removeSelected = () => {
    if (selected == null) return;
    push(path.filter((_, i) => i !== selected));
    if (closed && path.length - 1 < 3) setClosed(false);
  };

  const validationError = validateRing(path);

  const handleClose = () => {
    if (validationError) {
      toast({ title: 'Não dá para fechar', description: validationError, variant: 'destructive' });
      return;
    }
    setClosed(true);
  };

  const handleSave = () => {
    if (!closed) {
      toast({ title: 'Feche a região antes de salvar', variant: 'destructive' });
      return;
    }
    try {
      onSave(toGeoJSON(path));
    } catch (err) {
      toast({ title: 'Região inválida', description: err?.message, variant: 'destructive' });
    }
  };

  const handleClear = () => {
    push([]);
    setClosed(false);
  };

  const latLngs = path.map((p) => [p.lat, p.lng]);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Clique no mapa para adicionar vértices da região
        {zoneName ? ` de "${zoneName}"` : ''}. Arraste os pontos para ajustar.
      </p>
      <div className="overflow-hidden rounded-xl border border-border">
        <MapContainer
          center={[center.lat, center.lng]}
          zoom={13}
          scrollWheelZoom
          className="h-[320px] w-full sm:h-[380px] z-0"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ClickCatcher onAdd={addVertex} disabled={false} />
          <FitToPath path={path} />
          {latLngs.length >= 3 && (
            <Polygon positions={closed ? [...latLngs, latLngs[0]] : latLngs} />
          )}
          {path.map((p, i) => (
            <CircleMarker
              key={i}
              center={[p.lat, p.lng]}
              radius={selected === i ? 9 : 6}
              draggable
              eventHandlers={{
                dragend: (e) => moveVertex(i, e.target.getLatLng()),
                click: () => setSelected(selected === i ? null : i),
              }}
            />
          ))}
        </MapContainer>
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {path.length === 0
          ? 'Nenhum ponto ainda.'
          : `${path.length} ponto${path.length === 1 ? '' : 's'}${closed ? ' • região fechada' : ''}${selected != null ? ` • ponto ${selected + 1} selecionado` : ''}`}
        {validationError && !closed && path.length > 0 ? ` — ${validationError}` : ''}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" className="h-9" disabled={past.length === 0} onClick={() => { setFuture((f) => [path, ...f]); const prev = past[past.length - 1]; setPast((p) => p.slice(0, -1)); setPath(prev); setSelected(null); }} aria-label="Desfazer">
          <Undo2 className="h-4 w-4" /> Desfazer
        </Button>
        <Button variant="outline" size="sm" className="h-9" disabled={future.length === 0} onClick={() => { const [next, ...rest] = future; setPast((p) => [...p.slice(-MAX_HISTORY + 1), path]); setPath(next); setFuture(rest); setSelected(null); }} aria-label="Refazer">
          <Redo2 className="h-4 w-4" /> Refazer
        </Button>
        {!closed ? (
          <Button size="sm" className="h-9" onClick={handleClose}>
            <Check className="h-4 w-4" /> Fechar região
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="h-9" onClick={() => setClosed(false)}>
            Reabrir
          </Button>
        )}
        <Button variant="outline" size="sm" className="h-9" disabled={selected == null} onClick={removeSelected}>
          <X className="h-4 w-4" /> Remover ponto
        </Button>
        <Button variant="ghost" size="sm" className="h-9 text-destructive" onClick={handleClear}>
          <Trash2 className="h-4 w-4" /> Limpar
        </Button>
      </div>
      <div className="flex gap-2">
        <Button className="flex-1 min-h-11" disabled={saving || !closed} onClick={handleSave}>
          <MapPin className="h-4 w-4" /> {saving ? 'Salvando...' : 'Salvar região'}
        </Button>
      </div>
    </div>
  );
}
