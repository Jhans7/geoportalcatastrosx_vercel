-- ============================================================
-- Tabla de Reportes - GeoPortal Catastro Santa Cruz
-- Ejecutar en Supabase SQL Editor (esquema public)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.reportes_portal (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tipo_reporte    TEXT NOT NULL,
    comentario      TEXT,
    nombre_contacto TEXT,
    telefono        TEXT,
    ubicacion       GEOMETRY(Point, 4326),
    usuario         TEXT,
    estado          TEXT DEFAULT 'pendiente',
    fecha_cre       TIMESTAMPTZ DEFAULT now()
);

-- Índice espacial para consultas rápidas
CREATE INDEX IF NOT EXISTS idx_reportes_portal_ubicacion
    ON public.reportes_portal USING GIST (ubicacion);

-- Habilitar RLS
ALTER TABLE public.reportes_portal ENABLE ROW LEVEL SECURITY;

-- Permitir inserción anónima
CREATE POLICY "reportes_portal_insert_anon"
    ON public.reportes_portal
    FOR INSERT
    WITH CHECK (true);

-- Permitir lectura anónima
CREATE POLICY "reportes_portal_select_anon"
    ON public.reportes_portal
    FOR SELECT
    USING (true);

-- Comentario de tabla
COMMENT ON TABLE public.reportes_portal IS 'Reportes ciudadanos del GeoPortal - Catastro Santa Cruz';
