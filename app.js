// ============================================================
// GeoPortal Catastro Santa Cruz - Aplicación
// ============================================================

// Proyecciones UTM comunes en Ecuador
proj4.defs('EPSG:32717', '+proj=utm +zone=17 +south +datum=WGS84 +units=m +no_defs');
proj4.defs('EPSG:32718', '+proj=utm +zone=18 +south +datum=WGS84 +units=m +no_defs');
proj4.defs('EPSG:32617', '+proj=utm +zone=17 +datum=WGS84 +units=m +no_defs');
proj4.defs('EPSG:32618', '+proj=utm +zone=18 +datum=WGS84 +units=m +no_defs');
proj4.defs('EPSG:3857',  '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +no_defs');

function convertirCoordenadas(coords, fromEPSG) {
    if (typeof coords[0] === 'number') {
        try {
            const [lon, lat] = proj4(fromEPSG, 'EPSG:4326', [coords[0], coords[1]]);
            if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
            return [lon, lat];
        } catch (_) { return null; }
    }
    const resultado = [];
    for (const c of coords) {
        const conv = convertirCoordenadas(c, fromEPSG);
        if (conv === null) return null;
        resultado.push(conv);
    }
    return resultado;
}

function reprojectarGeom(geom) {
    const crsName = geom?.crs?.properties?.name;
    if (!crsName || crsName === 'EPSG:4326') return geom;
    const match = crsName.match(/EPSG:(\d+)/i);
    if (!match) return geom;
    const fromEPSG = 'EPSG:' + match[1];
    if (!proj4.defs(fromEPSG)) return geom;
    const newCoords = convertirCoordenadas(geom.coordinates, fromEPSG);
    if (!newCoords) return null;
    return { type: geom.type, coordinates: newCoords };
}

// ============================================================
// MAPA
// ============================================================

const map = L.map('map').setView([-0.63, -90.35], 10);

// Mapa base inicial: Google Satélite
const mapaBaseGoogleSatelite = L.tileLayer(
    'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
    {
        attribution: 'Map data &copy; Google',
        maxZoom: 21,
        maxNativeZoom: 21,
        subdomains: ['mt0','mt1','mt2','mt3'],
        keepBuffer: 4,
        crossOrigin: true
    }
);

const mapaBaseGoogleHibrido = L.tileLayer(
    'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
    {
        attribution: 'Map data &copy; Google',
        maxZoom: 21,
        maxNativeZoom: 21,
        subdomains: ['mt0','mt1','mt2','mt3'],
        keepBuffer: 4,
        crossOrigin: true
    }
);

const mapaBaseCallejero = L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19
    }
);

const mapaBaseSatelite = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/' +
    'World_Imagery/MapServer/tile/{z}/{y}/{x}',
    {
        attribution: 'Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics',
        maxNativeZoom: 17,
        maxZoom: 21,
        keepBuffer: 4,
        updateWhenZooming: false,
        updateWhenIdle: true
    }
);

const etiquetasHibridas = L.tileLayer(
    'https://services.arcgisonline.com/ArcGIS/rest/services/' +
    'Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    {
        attribution: 'Labels &copy; Esri',
        maxNativeZoom: 17,
        maxZoom: 21,
        pane: 'overlayPane',
        keepBuffer: 4
    }
);

mapaBaseGoogleSatelite.addTo(map);
mapaBaseSatelite.addTo(map);
etiquetasHibridas.addTo(map);

let mapaBaseActivo = 'google_satelite';

let avisoSateliteMostrado = false;
mapaBaseSatelite.on('tileerror', () => {
    if (avisoSateliteMostrado) return;
    avisoSateliteMostrado = true;
    estado(
        'La imagen satelital no tiene el mismo nivel de detalle en toda la isla. ' +
        'Se mostrará el último acercamiento disponible.',
        'orange', 6000
    );
});

let avisoGoogleMostrado = false;
function avisarErrorGoogle() {
    if (avisoGoogleMostrado) return;
    avisoGoogleMostrado = true;
    estado(
        'Google no respondió. Usa Esri Satélite o Esri Híbrido como respaldo.',
        'orange', 6500
    );
}
mapaBaseGoogleSatelite.on('tileerror', avisarErrorGoogle);
mapaBaseGoogleHibrido.on('tileerror', avisarErrorGoogle);

let controlCapas = null;
let capasCargadas = {};

const colores = [
    '#e41a1c','#377eb8','#4daf4a','#984ea3',
    '#ff7f00','#a65628','#f781bf','#999999'
];

// ============================================================
// TOAST / ESTADO
// ============================================================

let temporizadorToast = null;

function clasificarEstado(color) {
    const valor = String(color || '').toLowerCase();
    if (valor.includes('red') || valor.includes('rojo') || valor.includes('b71') || valor.includes('c62')) return 'error';
    if (valor.includes('orange') || valor.includes('naranja') || valor.includes('e65') || valor.includes('d97')) return 'advertencia';
    if (valor.includes('green') || valor.includes('verde') || valor.includes('1b5') || valor.includes('2e7')) return 'ok';
    return 'normal';
}

function cerrarToast() {
    const toast = document.getElementById('toast_estado');
    toast.classList.remove('visible');
    if (temporizadorToast) { clearTimeout(temporizadorToast); temporizadorToast = null; }
}

function estado(msg, color='black', duracion=7000) {
    const textoEstado = String(msg || '');
    if (
        typeof progresoCargaActivo !== 'undefined' &&
        progresoCargaActivo &&
        /cargando|cargada correctamente|cargadas correctamente|registros/i.test(textoEstado)
    ) return;

    const tipo = clasificarEstado(color);
    const toast = document.getElementById('toast_estado');
    const icono = document.getElementById('toast_icono');
    const titulo = document.getElementById('toast_titulo');
    const mensaje = document.getElementById('toast_mensaje');

    toast.className = `toast-estado ${tipo}`;
    mensaje.textContent = String(msg || '');

    if (tipo === 'ok') { icono.textContent = '✓'; titulo.textContent = 'Proceso completado'; }
    else if (tipo === 'error') { icono.textContent = '!'; titulo.textContent = 'Se produjo un error'; }
    else if (tipo === 'advertencia') { icono.textContent = '!'; titulo.textContent = 'Atención'; }
    else { icono.textContent = 'i'; titulo.textContent = 'Información'; }

    requestAnimationFrame(() => toast.classList.add('visible'));

    if (temporizadorToast) clearTimeout(temporizadorToast);
    const esProgreso = /cargando|consultando|limpiando/i.test(String(msg || ''));
    temporizadorToast = setTimeout(cerrarToast, esProgreso ? 2500 : duracion);
}

document.getElementById('toast_cerrar').addEventListener('click', cerrarToast);

// ============================================================
// SECCIONES PLEGABLES
// ============================================================

function alternarSeccion(idSeccion, idBoton) {
    const seccion = document.getElementById(idSeccion);
    const boton = document.getElementById(idBoton);
    const plegada = seccion.classList.toggle('plegada');
    boton.textContent = plegada ? '▾' : '▴';
    boton.title = plegada ? 'Mostrar sección' : 'Ocultar sección';
    setTimeout(() => map.invalidateSize(), 220);
}

// ============================================================
// CONEXIÓN SUPABASE
// ============================================================

function normalizarURL(valor) {
    let texto = String(valor || '').trim();
    if (!texto) return '';
    texto = texto.replace(/\s+/g, '');
    try {
        const url = new URL(texto);
        if (url.protocol !== 'https:') return '';
        return `${url.protocol}//${url.host}`;
    } catch (_) { return ''; }
}

function credenciales() {
    const url = normalizarURL(document.getElementById('supabase_url').value);
    const key = document.getElementById('supabase_key').value.trim();
    return { url, key };
}

function nombreProyectoDesdeURL(url) {
    try {
        const host = new URL(url).hostname;
        return host.replace('.supabase.co', '');
    } catch (_) { return 'Proyecto Supabase'; }
}

function actualizarEstadoConexion(conectado) {
    const dot = document.getElementById('estado_conexion_dot');
    const dotGrande = document.getElementById('estado_conexion_dot_grande');
    const perfilEstado = document.querySelector('.perfil-estado');

    [dot, dotGrande].forEach(elemento => {
        if (!elemento) return;
        elemento.classList.toggle('conectado', conectado);
        elemento.classList.toggle('desconectado', !conectado);
    });

    if (perfilEstado) {
        perfilEstado.textContent = conectado ? '● Conexión activa' : '● Sin conexión';
        perfilEstado.style.background = conectado ? '#ecfdf5' : '#fef2f2';
        perfilEstado.style.color = conectado ? '#047857' : '#b91c1c';
    }

    const boton = document.getElementById('perfil_btn');
    if (boton) {
        boton.title = conectado ? 'Usuario conectado' : 'Usuario desconectado';
        boton.setAttribute('aria-label',
            conectado ? 'Abrir menú de conexión. Estado conectado'
                      : 'Abrir menú de conexión. Estado desconectado'
        );
    }
}

function mostrarModoConectado(url) {
    const proyecto = nombreProyectoDesdeURL(url);
    document.getElementById('pantalla_inicio').style.display = 'none';
    const appPrincipal = document.getElementById('app_principal');
    appPrincipal.style.display = 'grid';
    appPrincipal.classList.add('activo');
    document.getElementById('perfil_conexion').style.display = 'block';
    document.getElementById('perfil_proyecto').textContent = `${proyecto}.supabase.co`;
    document.getElementById('perfil_menu').classList.remove('abierto');
    actualizarEstadoConexion(true);
    setTimeout(() => { map.invalidateSize(); map.setView([-0.63, -90.35], 10); }, 150);
}

function mostrarConexion() {
    document.getElementById('app_principal').style.display = 'none';
    document.getElementById('app_principal').classList.remove('activo');
    document.getElementById('pantalla_inicio').style.display = 'flex';
    document.getElementById('perfil_menu').classList.remove('abierto');
    actualizarEstadoConexion(false);
    document.getElementById('supabase_key').value = '';
    document.getElementById('supabase_key').focus();
}

function desconectar() {
    Object.values(capasCargadas).forEach(c => map.removeLayer(c));
    capasCargadas = {};
    capasSeleccionadasParaQuitar.clear();
    actualizarPanelCapasQGIS();
    actualizarBotonQuitarSeleccion();
    document.getElementById('supabase_url').value = '';
    document.getElementById('supabase_key').value = '';
    document.getElementById('app_principal').style.display = 'none';
    document.getElementById('pantalla_inicio').style.display = 'flex';
    document.getElementById('perfil_menu').classList.remove('abierto');
    actualizarEstadoConexion(false);
    document.getElementById('bloque_tablas').style.display = 'none';
    document.getElementById('btn_cargar').style.display = 'none';
    document.getElementById('lista_tablas').innerHTML = '';
    const vacio = document.getElementById('panel_disponibles_vacio');
    if (vacio) { vacio.style.display = 'block'; vacio.textContent = 'Conéctate para consultar las capas disponibles.'; }
}

document.getElementById('perfil_btn').addEventListener('click', (evento) => {
    evento.stopPropagation();
    document.getElementById('perfil_menu').classList.toggle('abierto');
});

document.addEventListener('click', (evento) => {
    const perfil = document.getElementById('perfil_conexion');
    if (!perfil.contains(evento.target)) {
        document.getElementById('perfil_menu').classList.remove('abierto');
    }
});

function mostrarMensajeLogin(texto, tipo = 'info') {
    const elemento = document.getElementById('mensaje_login');
    if (!elemento) return;
    elemento.textContent = texto;
    elemento.className = `visible ${tipo}`;
}

function ocultarMensajeLogin() {
    const elemento = document.getElementById('mensaje_login');
    if (!elemento) return;
    elemento.textContent = '';
    elemento.className = '';
}

function headersSupabase(apiKey, conJson = true) {
    const headers = { apikey: apiKey };
    if (conJson) headers['Content-Type'] = 'application/json';
    if (apiKey.startsWith('eyJ')) headers.Authorization = `Bearer ${apiKey}`;
    return headers;
}

async function consultarCapasEspaciales(url, key) {
    const respuesta = await fetch(`${url}/rest/v1/rpc/geocat_listar_capas`, {
        method: 'POST',
        headers: headersSupabase(key),
        body: '{}',
        cache: 'no-store'
    });
    if (!respuesta.ok) {
        const detalle = await respuesta.text();
        throw new Error(`No se pudo consultar el catálogo automático de capas. Ejecuta primero el SQL GeoCat SX 2.0. Detalle: ${detalle}`);
    }
    const filas = await respuesta.json();
    const tablas = (Array.isArray(filas) ? filas : [])
        .map(fila => fila.table_name || fila.tablename || fila.nombre_tabla || Object.values(fila)[0])
        .filter(Boolean)
        .map(nombre => String(nombre).trim())
        .filter(Boolean);
    return {
        tablas: [...new Set(tablas)].sort((a, b) => a.localeCompare(b, 'es')),
        totalPublicas: tablas.length,
        noEspaciales: [],
        fuente: 'geocat_listar_capas'
    };
}

async function actualizarCapasDisponibles() {
    const { url, key } = credenciales();
    const boton = document.getElementById('btn_actualizar_capas');
    if (!url || !key) { estado('No hay una conexión activa con Supabase.', 'orange', 4000); return; }
    const contenidoOriginal = boton ? boton.innerHTML : '';
    if (boton) { boton.disabled = true; boton.innerHTML = '<span class="icono-recargar" style="animation:spin 1s linear infinite">⟳</span>'; }
    try {
        const resultado = await consultarCapasEspaciales(url, key);
        const tablas = resultado.tablas;
        if (!tablas.length) throw new Error('No se encontraron tablas con una geometría válida.');
        mostrarCheckboxes(tablas);
        if (resultado.noEspaciales.length) {
            estado(`${tablas.length} capa(s) espacial(es). ${resultado.noEspaciales.length} tabla(s) sin geometry/geography: ${resultado.noEspaciales.join(', ')}`, 'orange', 9000);
        } else {
            estado(`${tablas.length} capa(s) espacial(es) actualizada(s).`, 'green', 4500);
        }
    } catch (error) {
        console.error(error);
        estado('No fue posible actualizar las capas. Revisa la función SQL y los permisos.', 'red', 6500);
    } finally {
        if (boton) { boton.disabled = false; boton.innerHTML = contenidoOriginal; }
    }
}

async function descubrirTablas() {
    const botonConectar = document.getElementById('btn_descubrir');
    const { url, key } = credenciales();
    ocultarMensajeLogin();
    if (!url) { mostrarMensajeLogin('La URL no es válida. Puedes pegarla con o sin /rest/v1 al final.', 'error'); return; }
    if (!key) { mostrarMensajeLogin('Ingresa la API Key para continuar.', 'advertencia'); return; }
    botonConectar.disabled = true;
    botonConectar.textContent = 'Conectando...';
    mostrarMensajeLogin('Verificando la conexión y consultando las capas...', 'info');
    try {
        const resultado = await consultarCapasEspaciales(url, key);
        const tablas = resultado.tablas;
        if (!tablas.length) throw new Error('La conexión fue correcta, pero no se encontraron tablas con geometría válida.');
        mostrarCheckboxes(tablas);
        const detalleNoEspacial = resultado.noEspaciales.length
            ? ` Hay ${resultado.noEspaciales.length} tabla(s) sin geometry/geography: ${resultado.noEspaciales.join(', ')}.`
            : '';
        mostrarMensajeLogin(
            `Conexión correcta. Se encontraron ${tablas.length} capas espaciales.` + detalleNoEspacial,
            resultado.noEspaciales.length ? 'advertencia' : 'ok'
        );
        setTimeout(() => mostrarModoConectado(url), 500);
    } catch (error) {
        console.error('Error de conexión:', error);
        mostrarMensajeLogin(error.message || 'No se pudo establecer la conexión con Supabase.', 'error');
    } finally {
        botonConectar.disabled = false;
        botonConectar.textContent = 'Conectar';
    }
}

// ============================================================
// CHECKBOXES / CAPAS DISPONIBLES
// ============================================================

function escaparAtributoHtml(valor) {
    return String(valor).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
}

function mostrarCheckboxes(tablas) {
    const lista = document.getElementById('lista_tablas');
    lista.innerHTML = tablas.map(tabla => {
        const segura = escaparAtributoHtml(tabla);
        const cargada = Object.prototype.hasOwnProperty.call(capasCargadas, tabla);
        return `
            <label title="${segura}${cargada ? ' · Ya cargada' : ''}" class="${cargada ? 'capa-cargada' : ''}">
                <input type="checkbox" value="${segura}" ${cargada ? 'disabled' : ''}>
                <span class="capa-nombre">${segura}</span>
            </label>`;
    }).join('');
    document.getElementById('panel_disponibles_vacio').style.display = 'none';
    document.getElementById('bloque_tablas').style.display = 'flex';
    document.getElementById('bloque_tablas').style.flexDirection = 'column';
    document.getElementById('btn_cargar').style.display = 'block';
    actualizarBotonMarcarTodas();
}

function actualizarBotonMarcarTodas() {
    const boton = document.getElementById('btn_marcar_todas');
    if (!boton) return;
    const disponibles = Array.from(document.querySelectorAll('#lista_tablas input[type="checkbox"]:not(:disabled)'));
    boton.disabled = disponibles.length === 0;
    const todasMarcadas = disponibles.length && disponibles.every(cb => cb.checked);
    boton.textContent = todasMarcadas ? 'Desmarcar' : 'Marcar todas';
}

function alternarSeleccionCapasDisponibles() {
    const disponibles = Array.from(document.querySelectorAll('#lista_tablas input[type="checkbox"]:not(:disabled)'));
    if (!disponibles.length) return;
    const todasMarcadas = disponibles.every(cb => cb.checked);
    disponibles.forEach(cb => cb.checked = !todasMarcadas);
    actualizarBotonMarcarTodas();
}

document.addEventListener('change', evento => {
    if (evento.target.matches('#lista_tablas input[type="checkbox"]')) actualizarBotonMarcarTodas();
});

// ============================================================
// CARGA DE CAPAS
// ============================================================

async function cargarCapas() {
    const tablas = Array.from(document.querySelectorAll('#lista_tablas input[type=checkbox]:checked')).map(cb => cb.value);
    if (tablas.length === 0) { estado('Selecciona al menos una tabla.', 'orange'); return; }
    const { url, key } = credenciales();
    await ejecutarCarga(tablas, url, key);
}

async function ejecutarCarga(tablas, supabaseUrl, apiKey) {
    if (!supabaseUrl || !apiKey) { estado('Completa la URL y la API Key.', 'red'); return; }
    const tablasNuevas = tablas.filter(tabla => !Object.prototype.hasOwnProperty.call(capasCargadas, tabla));
    const tablasYaCargadas = tablas.filter(tabla => Object.prototype.hasOwnProperty.call(capasCargadas, tabla));

    if (tablasNuevas.length === 0) {
        estado(tablasYaCargadas.length ? 'La selección ya está cargada en el mapa.' : 'Selecciona al menos una capa nueva.', 'orange');
        return;
    }

    mostrarProgresoCarga(
        tablasNuevas.length === 1 ? 'Cargando capa...' : `Cargando ${tablasNuevas.length} capas...`,
        'Conectando con Supabase...'
    );

    try {
        const grupoNuevas = L.featureGroup();
        let cargadasNuevas = 0;
        let nuevasGeometrias = 0;
        const sinGeom = [];
        const cantidadExistentes = Object.keys(capasCargadas).length;

        for (let i = 0; i < tablasNuevas.length; i++) {
            const tabla = tablasNuevas[i];
            estado(tablasNuevas.length > 1 ? `Cargando capa ${i + 1} de ${tablasNuevas.length}...` : 'Cargando capa...', 'black', 3000);
            const indiceColor = (cantidadExistentes + cargadasNuevas) % colores.length;
            const capa = await consultarTabla(tabla, colores[indiceColor], supabaseUrl, apiKey);
            if (capa) {
                capa.addTo(map);
                capasCargadas[tabla] = capa;
                capa.eachLayer(layer => grupoNuevas.addLayer(layer));
                cargadasNuevas++;
                nuevasGeometrias += capa.options.totalRegistros || 0;
                actualizarPanelCapasQGIS();
            } else {
                sinGeom.push(tabla);
            }
        }

        if (grupoNuevas.getLayers().length > 0) {
            map.fitBounds(grupoNuevas.getBounds(), { padding: [25, 25], maxZoom: 18 });
        }

        actualizarPanelCapasQGIS();

        if (cargadasNuevas > 0) {
            actualizarProgresoCarga(100, cargadasNuevas === 1 ? 'Capa cargada correctamente' : 'Capas cargadas correctamente');
            ocultarProgresoCarga(1400);
        } else if (sinGeom.length > 0) {
            actualizarProgresoCarga(100, 'No fue posible cargar la capa');
            ocultarProgresoCarga(1800);
        }
    } catch (err) {
        console.error(err);
        actualizarProgresoCarga(100, 'No fue posible cargar la capa');
        ocultarProgresoCarga(1800);
    }
}

// ============================================================
// POPUP DE ATRIBUTOS
// ============================================================

const CAMPOS_OCULTOS_POPUP = new Set([
    'geom','geometry','geography','geojson','geometry_geojson',
    'wkb_geometry','the_geom','shape','created_at','updated_at',
    'xmin','xmax','ymin','ymax'
]);

const ETIQUETAS_POPUP = {
    id:'Identificador', gid:'Código interno',
    clave:'Clave', clave_cat:'Clave', clave_cata:'Clave', clave_catastral:'Clave', clav_cata:'Clave', cod_cat:'Clave',
    propietario:'Propietario', propietari:'Propietario', propietario_nombre:'Propietario', nombre_propietario:'Propietario',
    identificador:'Identificador', identifica:'Identificador', identificacion:'Identificador', cedula:'Identificador', cedula_ruc:'Identificador', ruc:'Identificador', pasaporte:'Identificador',
    barrio:'Barrio', barrio_sec:'Barrio', num_bloque:'Número de bloque', numero_bloque:'Número de bloque', numbloque:'Número de bloque',
    num_piso:'Número de piso', numero_piso:'Número de piso', numpiso:'Número de piso', barrio_sector:'Barrio', sector_barrio:'Barrio', sector:'Sector',
    nombre:'Nombre', nombres:'Nombres', apellidos:'Apellidos', razon_social:'Razón social', direccion:'Dirección', parroquia:'Parroquia',
    area:'Área', area_terre:'Área del terreno', area_terreno:'Área del terreno', areaconst:'Área construida', area_const:'Área construida',
    area_m2:'Área (m²)', superficie:'Superficie', uso:'Uso', uso_suelo:'Uso de suelo', estado:'Estado',
    tipo_catas:'Tipo de catastro', lote_min:'Lote mínimo', no_pit:'PIT',
    frontal:'Retiro frontal', lateral_1:'Retiro lateral 1', lateral_2:'Retiro lateral 2', posterior:'Retiro posterior',
    cos_pb:'COS planta baja', cos_total:'COS total', lote_minim:'Lote mínimo normativo', altura_max:'Altura máxima',
    pisos:'Número de pisos', uso_genera:'Uso general', tratamient:'Tratamiento', tsunami:'Tsunami',
    encanadas:'Encañadas', inundacion:'Inundación', grietas:'Grietas', barranco:'Barranco', tuneles:'Túneles',
    ubicacion:'Ubicación', frente_min:'Frente mínimo', subpit:'SubPIT', observacion:'Observación', observaciones:'Observaciones',
    latitud:'Latitud', longitud:'Longitud'
};

const GRUPOS_CAMPOS_PRINCIPALES_POPUP = [
    ['clave_catastral','clave_cata','clave_cat','clav_cata','clave','cod_cat'],
    ['propietario','propietari','propietario_nombre','nombre_propietario'],
    ['identificador','identifica','identificacion','cedula_ruc','cedula','ruc','pasaporte'],
    ['barrio_sec','barrio_sector','sector_barrio','barrio']
];

const GRUPOS_CAMPOS_CONSTRUCCION_POPUP = [
    ['num_bloque','numero_bloque','numbloque','bloque','nro_bloque'],
    ['num_piso','numero_piso','numpiso','piso','nro_piso']
];

const ORDEN_SECUNDARIO_CATASTRO_POPUP = [
    ['ubicacion','latitud','longitud'],
    ['area_terre','area_terreno','area','area_m2','superficie'],
    ['areaconst','area_const','area_construida','area_construccion'],
    ['estado'], ['tipo_catas','tipo_catastro','tipo'], ['lote_min','lote_minimo'],
    ['no_pit','nro_pit','pit'], ['frontal','retiro_frontal'],
    ['lateral_1','lateral1','retiro_lateral_1'], ['lateral_2','lateral2','retiro_lateral_2'],
    ['posterior','retiro_posterior'], ['cos_pb','cospb'], ['cos_total','costotal'],
    ['lote_minim','lote_minimo_norma'], ['altura_max','altura_maxima'],
    ['pisos','numero_pisos','num_pisos'], ['uso_genera','uso_general','uso','uso_suelo'],
    ['tratamient','tratamiento'], ['tsunami'], ['encanadas','encañadas','encanada'],
    ['inundacion','inundable'], ['grietas'], ['barranco'], ['tuneles','túneles'],
    ['ubicacion','ubicación'], ['frente_min','frente_minimo'], ['subpit','sub_pit']
];

function normalizarNombreCampoPopup(nombre) {
    return String(nombre).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
}

function buscarCampoPopup(campos, variantes) {
    for (const variante of variantes) {
        const encontrado = campos.find(campo => normalizarNombreCampoPopup(campo) === variante);
        if (encontrado) return encontrado;
    }
    return null;
}

function escaparHtmlPopup(valor) {
    return String(valor ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#039;");
}

function etiquetaCampoPopup(campo) {
    const clave = normalizarNombreCampoPopup(campo);
    if (ETIQUETAS_POPUP[clave]) return ETIQUETAS_POPUP[clave];
    return String(campo).replaceAll('_',' ').replace(/\b\w/g, letra => letra.toUpperCase());
}

function valorUtilPopup(valor) {
    if (valor === null || valor === undefined) return false;
    if (typeof valor === 'string') {
        const texto = valor.trim().toLowerCase();
        if (!texto) return false;
        return !['null','undefined','sin informacion','sin información','no aplica','n/a','ninguna','no tiene'].includes(texto);
    }
    return true;
}

function formatearValorPopup(campo, valor) {
    if (typeof valor === 'boolean') return valor ? 'Sí' : 'No';
    if (typeof valor === 'number') {
        const nombre = String(campo).toLowerCase();
        if (nombre.includes('area') || nombre.includes('superficie')) return `${valor.toLocaleString('es-EC',{maximumFractionDigits:2})} m²`;
        return valor.toLocaleString('es-EC');
    }
    if (typeof valor === 'object' && valor !== null) { try { return JSON.stringify(valor); } catch (_) { return '[Objeto]'; } }
    return String(valor);
}

function esCapaUnidadesConstructivas(tabla) {
    const nombre = normalizarNombreCampoPopup(tabla);
    return nombre.includes('unidades_constructivas') || nombre.includes('unidad_constructiva');
}

function tituloPopupDesdePropiedades(propiedades, tabla) {
    if (esCapaUnidadesConstructivas(tabla)) {
        const campos = Object.keys(propiedades);
        const bloque = buscarCampoPopup(campos, GRUPOS_CAMPOS_CONSTRUCCION_POPUP[0]);
        const piso = buscarCampoPopup(campos, GRUPOS_CAMPOS_CONSTRUCCION_POPUP[1]);
        const partes = [];
        if (bloque && valorUtilPopup(propiedades[bloque])) partes.push(`Bloque ${formatearValorPopup(bloque, propiedades[bloque])}`);
        if (piso && valorUtilPopup(propiedades[piso])) partes.push(`Piso ${formatearValorPopup(piso, propiedades[piso])}`);
        return partes.length ? partes.join(' · ') : tabla;
    }
    const campos = Object.keys(propiedades);
    const campoClave = buscarCampoPopup(campos, GRUPOS_CAMPOS_PRINCIPALES_POPUP[0]);
    if (campoClave && valorUtilPopup(propiedades[campoClave])) return formatearValorPopup(campoClave, propiedades[campoClave]);
    return tabla;
}

function crearFilasPopup(campos, propiedades) {
    return campos.map(campo => `
        <div class="popup-ficha-etiqueta">${escaparHtmlPopup(etiquetaCampoPopup(campo))}</div>
        <div class="popup-ficha-valor">${escaparHtmlPopup(formatearValorPopup(campo, propiedades[campo]))}</div>
    `).join('');
}

function ordenarCamposSecundariosCatastro(campos) {
    const ordenados = [];
    const usados = new Set();
    for (const grupo of ORDEN_SECUNDARIO_CATASTRO_POPUP) {
        const encontrado = buscarCampoPopup(campos, grupo);
        if (encontrado && !usados.has(encontrado)) { ordenados.push(encontrado); usados.add(encontrado); }
    }
    for (const campo of campos) { if (!usados.has(campo)) { ordenados.push(campo); usados.add(campo); } }
    return ordenados;
}

window.toggleAtributosPopup = function(boton, evento) {
    if (evento) { evento.preventDefault(); evento.stopPropagation(); }
    const bloque = boton.closest('.popup-ficha-detalles');
    if (!bloque) return false;
    const abrir = !bloque.classList.contains('abierto');
    bloque.classList.toggle('abierto', abrir);
    boton.setAttribute('aria-expanded', abrir ? 'true' : 'false');
    const cantidad = boton.dataset.cantidad || '';
    const texto = boton.querySelector('.popup-ficha-texto');
    if (texto) texto.textContent = abrir ? `Ocultar (${cantidad})` : `Ver más (${cantidad})`;
    const contenido = bloque.querySelector('.popup-ficha-detalles-contenido');
    if (contenido && abrir) contenido.scrollTop = 0;
    if (typeof map !== 'undefined' && map.getPopup && map.getPopup()) {
        setTimeout(() => { const popup = map.getPopup(); if (popup) popup.update(); }, 20);
    }
    return false;
};

function crearPopupFormateado(propiedades, tabla) {
    const camposValidos = Object.keys(propiedades)
        .filter(campo => !CAMPOS_OCULTOS_POPUP.has(String(campo).toLowerCase()))
        .filter(campo => valorUtilPopup(propiedades[campo]));

    const camposPrincipales = [];
    const camposSecundarios = [];
    const gruposPrincipales = esCapaUnidadesConstructivas(tabla) ? GRUPOS_CAMPOS_CONSTRUCCION_POPUP : GRUPOS_CAMPOS_PRINCIPALES_POPUP;

    for (const grupo of gruposPrincipales) {
        const encontrado = buscarCampoPopup(camposValidos, grupo);
        if (encontrado && !camposPrincipales.includes(encontrado)) camposPrincipales.push(encontrado);
    }

    const candidatosSecundarios = [];
    for (const campo of camposValidos) {
        const normalizado = normalizarNombreCampoPopup(campo);
        if (!camposPrincipales.includes(campo) && !['id','gid'].includes(normalizado)) candidatosSecundarios.push(campo);
    }

    const secundariosOrdenados = esCapaUnidadesConstructivas(tabla) ? candidatosSecundarios : ordenarCamposSecundariosCatastro(candidatosSecundarios);
    camposSecundarios.push(...secundariosOrdenados);

    const titulo = tituloPopupDesdePropiedades(propiedades, tabla);
    let contenido = `
      <div class="popup-ficha">
        <div class="popup-ficha-header">
          <div class="popup-ficha-titulo">${escaparHtmlPopup(tabla)}</div>
          <div class="popup-ficha-subtitulo">${escaparHtmlPopup(titulo)}</div>
        </div>
        <div class="popup-ficha-cuerpo">`;

    if (camposPrincipales.length) {
        contenido += `
        <section class="popup-ficha-seccion">
          <div class="popup-ficha-seccion-titulo">Información principal</div>
          <div class="popup-ficha-grid">${crearFilasPopup(camposPrincipales, propiedades)}</div>
        </section>`;
    }

    if (camposSecundarios.length) {
        contenido += `
        <div class="popup-ficha-detalles">
          <button type="button" class="popup-ficha-toggle" aria-expanded="false"
            data-cantidad="${camposSecundarios.length}"
            onclick="return window.toggleAtributosPopup(this, event)">
            <span class="popup-ficha-flecha">▶</span>
            <span class="popup-ficha-texto">Ver más (${camposSecundarios.length})</span>
          </button>
          <div class="popup-ficha-detalles-contenido">
            <div class="popup-ficha-grid">${crearFilasPopup(camposSecundarios, propiedades)}</div>
          </div>
        </div>`;
    }

    if (!camposPrincipales.length && !camposSecundarios.length) {
        contenido += `<div class="popup-ficha-vacio">Este elemento no contiene atributos visibles.</div>`;
    }

    return contenido + '</div></div>';
}

// ============================================================
// PROGRESO DE CARGA
// ============================================================

let progresoCargaActivo = false;

function mostrarProgresoCarga(titulo, detalle = '') {
    progresoCargaActivo = true;
    document.getElementById('progreso_carga').classList.add('visible');
    document.getElementById('progreso_titulo').textContent = titulo || 'Cargando capa...';
    document.getElementById('progreso_detalle').textContent = detalle || 'Preparando la consulta...';
    actualizarProgresoCarga(3);
}

function actualizarProgresoCarga(porcentaje, detalle = '') {
    const valor = Math.max(0, Math.min(100, Math.round(porcentaje)));
    document.getElementById('progreso_porcentaje').textContent = `${valor} %`;
    document.getElementById('progreso_barra_interior').style.width = `${valor}%`;
    if (detalle) document.getElementById('progreso_detalle').textContent = detalle;
}

function ocultarProgresoCarga(demora = 650) {
    progresoCargaActivo = false;
    setTimeout(() => {
        if (progresoCargaActivo) return;
        document.getElementById('progreso_carga').classList.remove('visible');
    }, demora);
}

function porcentajeAproximadoPorPagina(pagina) {
    return Math.min(92, Math.round(8 + 84 * (1 - Math.exp(-pagina / 5))));
}

async function consultarTabla(tabla, color, supabaseUrl, apiKey) {
    const headers = { apikey: apiKey, 'Content-Type': 'application/json' };
    if (apiKey.startsWith('eyJ')) headers.Authorization = `Bearer ${apiKey}`;

    const TAMANO_BLOQUE = tabla === 'unidades_constructivas_sx' ? 150 : 300;
    let offset = 0;
    let total = 0;
    let paginaActual = 0;
    const grupoTabla = L.featureGroup();

    while (true) {
        paginaActual++;
        actualizarProgresoCarga(porcentajeAproximadoPorPagina(paginaActual), `Descargando "${tabla}"...`);

        const r = await fetch(`${supabaseUrl}/rest/v1/rpc/get_table_geojson`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ p_table_name: tabla, p_limit: TAMANO_BLOQUE, p_offset: offset })
        });

        if (!r.ok) {
            const detalle = await r.text();
            if (/no est[aá] autorizada|not authorized|no existe/i.test(detalle)) {
                throw new Error(`La capa "${tabla}" aparece en Supabase, pero la función get_table_geojson todavía no permite leerla. Ejecuta la configuración SQL automática actualizada.`);
            }
            throw new Error(`Error al cargar "${tabla}" (${r.status}). ${detalle}`);
        }

        let geojson = await r.json();
        if (Array.isArray(geojson) && geojson.length === 1) {
            const fila = geojson[0];
            geojson = fila.geojson || fila.resultado || fila.feature_collection || Object.values(fila)[0];
        }
        if (typeof geojson === 'string') geojson = JSON.parse(geojson);
        if (!geojson || geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
            throw new Error(`La función get_table_geojson no devolvió un FeatureCollection válido para "${tabla}".`);
        }

        const cantidad = geojson.features.length;
        if (cantidad === 0) break;

        const pagina = L.geoJSON(geojson, {
            style: { color, weight: 2, fillColor: color, fillOpacity: 0.35 },
            pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 6, fillColor: color, color: '#fff', weight: 1, fillOpacity: 0.85 }),
            onEachFeature: (feature, layer) => {
                if (feature.geometry?.type === 'Point' && feature.geometry?.coordinates) {
                    const props = feature.properties || {};
                    props.longitud = Number(feature.geometry.coordinates[0]).toFixed(6);
                    props.latitud = Number(feature.geometry.coordinates[1]).toFixed(6);
                }
                layer.bindPopup(crearPopupFormateado(feature.properties || {}, tabla), {
                    maxWidth: 420, minWidth: 290, autoPan: true,
                    autoPanPaddingTopLeft: [20, 95], autoPanPaddingBottomRight: [20, 45], keepInView: true
                });
                layer.on('click', eventoCapa => {
                    if (!herramientaEsMedicion()) return;
                    if (eventoCapa.originalEvent) {
                        eventoCapa.originalEvent._geocatMedicionProcesada = true;
                        L.DomEvent.preventDefault(eventoCapa.originalEvent);
                        L.DomEvent.stopPropagation(eventoCapa.originalEvent);
                    }
                    map.closePopup();
                    agregarPuntoMedicion(eventoCapa.latlng);
                });
                layer.on('dblclick', eventoCapa => {
                    if (!herramientaEsMedicion()) return;
                    if (eventoCapa.originalEvent) {
                        eventoCapa.originalEvent._geocatMedicionProcesada = true;
                        L.DomEvent.preventDefault(eventoCapa.originalEvent);
                        L.DomEvent.stopPropagation(eventoCapa.originalEvent);
                    }
                    finalizarMedicion();
                });
            }
        });

        pagina.eachLayer(layer => grupoTabla.addLayer(layer));
        total += cantidad;
        offset += cantidad;
        actualizarProgresoCarga(porcentajeAproximadoPorPagina(paginaActual), `${total.toLocaleString('es-EC')} registros cargados`);
        if (cantidad < TAMANO_BLOQUE) break;
        await new Promise(resolve => setTimeout(resolve, 50));
    }

    grupoTabla.options.totalRegistros = total;
    return total > 0 ? grupoTabla : null;
}

// ============================================================
// PANEL DE CAPAS CARGADAS (QGIS STYLE)
// ============================================================

function colorDeCapa(tabla) {
    const nombres = Object.keys(capasCargadas);
    const indice = Math.max(0, nombres.indexOf(tabla));
    return colores[indice % colores.length] || '#377eb8';
}

const capasSeleccionadasParaQuitar = new Set();

function actualizarAccionesCapasSeleccionadas() {
    const cantidad = Array.from(capasSeleccionadasParaQuitar).filter(tabla => capasCargadas[tabla]).length;
    ['btn_zoom_seleccion','btn_visibilidad_seleccion','btn_quitar_seleccion'].forEach(id => {
        const boton = document.getElementById(id);
        if (boton) boton.disabled = cantidad === 0;
    });
    const selectorColor = document.getElementById('color_capas_seleccionadas');
    const envolturaColor = document.getElementById('btn_color_seleccion');
    if (selectorColor) selectorColor.disabled = cantidad === 0;
    if (envolturaColor) envolturaColor.classList.toggle('deshabilitado', cantidad === 0);
}

function actualizarBotonQuitarSeleccion() { actualizarAccionesCapasSeleccionadas(); }

function actualizarPanelCapasQGIS() {
    const contenedor = document.getElementById('lista_capas_qgis');
    contenedor.innerHTML = '';
    for (const tabla of Array.from(capasSeleccionadasParaQuitar)) {
        if (!capasCargadas[tabla]) capasSeleccionadasParaQuitar.delete(tabla);
    }
    const entradas = Object.entries(capasCargadas);
    if (!entradas.length) {
        contenedor.innerHTML = '<div id="panel_capas_vacio">No hay capas cargadas todavía.</div>';
        actualizarBotonVisibilidadCapas();
        actualizarAccionesCapasSeleccionadas();
        return;
    }
    entradas.forEach(([tabla, capa], indice) => {
        const fila = document.createElement('div');
        fila.className = 'capa-qgis';
        fila.tabIndex = 0;
        fila.setAttribute('role', 'button');
        fila.setAttribute('aria-label', `Seleccionar capa ${tabla}`);
        if (capasSeleccionadasParaQuitar.has(tabla)) fila.classList.add('seleccionada');

        const colorActual = capa.options?.colorCapa || colores[indice % colores.length];

        const simbolo = document.createElement('span');
        simbolo.className = 'capa-simbolo';
        simbolo.style.color = colorActual;
        simbolo.style.background = `${colorActual}33`;
        simbolo.style.opacity = map.hasLayer(capa) ? '1' : '.42';

        const nombre = document.createElement('span');
        nombre.className = 'capa-nombre';
        nombre.textContent = tabla;
        nombre.title = `${tabla} · ${map.hasLayer(capa) ? 'Visible' : 'Oculta'}`;
        nombre.style.opacity = map.hasLayer(capa) ? '1' : '.58';

        const contador = document.createElement('span');
        contador.className = 'capa-contador';
        contador.textContent = `(${capa.options.totalRegistros || 0})`;

        function alternarSeleccionFila() {
            if (capasSeleccionadasParaQuitar.has(tabla)) { capasSeleccionadasParaQuitar.delete(tabla); fila.classList.remove('seleccionada'); }
            else { capasSeleccionadasParaQuitar.add(tabla); fila.classList.add('seleccionada'); }
            actualizarAccionesCapasSeleccionadas();
        }

        fila.addEventListener('click', alternarSeleccionFila);
        fila.addEventListener('keydown', evento => {
            if (evento.key === 'Enter' || evento.key === ' ') { evento.preventDefault(); alternarSeleccionFila(); }
        });
        fila.append(simbolo, nombre, contador);
        contenedor.appendChild(fila);
    });
    actualizarBotonVisibilidadCapas();
    actualizarAccionesCapasSeleccionadas();
}

function quitarCapa(tabla) {
    const capa = capasCargadas[tabla];
    if (!capa) return;
    if (map.hasLayer(capa)) map.removeLayer(capa);
    delete capasCargadas[tabla];
    if (typeof resultadosBusqueda !== 'undefined') {
        resultadosBusqueda = resultadosBusqueda.filter(r => r.nombreCapa !== tabla);
        if (resultadosBusqueda.length === 0) { indiceResultadoBusqueda = -1; if (typeof actualizarControlesBusqueda === 'function') actualizarControlesBusqueda(); }
    }
    actualizarPanelCapasQGIS();
    estado(`Capa "${tabla}" quitada del visor.`, 'green', 3200);
}

function obtenerNombresCapasSeleccionadas() {
    return Array.from(capasSeleccionadasParaQuitar).filter(tabla => capasCargadas[tabla]);
}

function zoomCapasSeleccionadas() {
    const nombres = obtenerNombresCapasSeleccionadas();
    if (!nombres.length) { estado('Selecciona al menos una capa.', 'orange', 3000); return; }
    const grupo = L.featureGroup();
    nombres.forEach(tabla => { const capa = capasCargadas[tabla]; if (capa) grupo.addLayer(capa); });
    const bounds = grupo.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [25, 25] });
}

function alternarVisibilidadSeleccionadas() {
    const nombres = obtenerNombresCapasSeleccionadas();
    if (!nombres.length) { estado('Selecciona al menos una capa.', 'orange', 3000); return; }
    const todasVisibles = nombres.every(tabla => map.hasLayer(capasCargadas[tabla]));
    nombres.forEach(tabla => {
        const capa = capasCargadas[tabla];
        if (!capa) return;
        if (todasVisibles) { if (map.hasLayer(capa)) map.removeLayer(capa); }
        else if (!map.hasLayer(capa)) capa.addTo(map);
    });
    actualizarPanelCapasQGIS();
    estado(todasVisibles ? `${nombres.length} capa(s) ocultada(s).` : `${nombres.length} capa(s) mostrada(s).`, 'green', 3000);
}

function cambiarColorCapasSeleccionadas(color) {
    const nombres = obtenerNombresCapasSeleccionadas();
    if (!nombres.length) { estado('Selecciona al menos una capa.', 'orange', 3000); return; }
    nombres.forEach(tabla => cambiarColorCapa(tabla, color));
    actualizarPanelCapasQGIS();
    estado(`Color actualizado en ${nombres.length} capa(s).`, 'green', 3000);
}

function quitarCapasSeleccionadas() {
    const nombres = Array.from(capasSeleccionadasParaQuitar).filter(tabla => capasCargadas[tabla]);
    if (!nombres.length) { estado('Selecciona una capa del panel para quitarla.', 'orange', 3200); actualizarBotonQuitarSeleccion(); return; }
    nombres.forEach(tabla => {
        const capa = capasCargadas[tabla];
        if (capa && map.hasLayer(capa)) map.removeLayer(capa);
        delete capasCargadas[tabla];
        capasSeleccionadasParaQuitar.delete(tabla);
    });
    if (typeof resultadosBusqueda !== 'undefined') {
        resultadosBusqueda = resultadosBusqueda.filter(r => !nombres.includes(r.nombreCapa));
        if (resultadosBusqueda.length === 0) { indiceResultadoBusqueda = -1; if (typeof actualizarControlesBusqueda === 'function') actualizarControlesBusqueda(); }
    }
    if (typeof capaResaltadoBusqueda !== 'undefined' && resultadosBusqueda.length === 0) capaResaltadoBusqueda.clearLayers();
    actualizarPanelCapasQGIS();
    actualizarBotonVisibilidadCapas();
    actualizarBotonQuitarSeleccion();
    actualizarCapasDisponibles?.();
    estado(nombres.length === 1 ? `Capa "${nombres[0]}" quitada del visor.` : `${nombres.length} capas quitadas del visor.`, 'green', 3500);
}

function actualizarBotonVisibilidadCapas() {
    const boton = document.getElementById('btn_alternar_capas');
    if (!boton) return;
    const capas = Object.values(capasCargadas);
    if (!capas.length) { boton.textContent = 'Encender todas'; boton.disabled = true; return; }
    boton.disabled = false;
    const todasVisibles = capas.every(capa => map.hasLayer(capa));
    boton.textContent = todasVisibles ? 'Apagar todas' : 'Encender todas';
    boton.title = todasVisibles ? 'Apagar todas las capas' : 'Encender todas las capas';
}

function alternarVisibilidadCapas() {
    const capas = Object.values(capasCargadas);
    if (!capas.length) { estado('No hay capas cargadas.', 'orange', 3000); actualizarBotonVisibilidadCapas(); return; }
    const todasVisibles = capas.every(capa => map.hasLayer(capa));
    capas.forEach(capa => {
        if (todasVisibles) { if (map.hasLayer(capa)) map.removeLayer(capa); }
        else { if (!map.hasLayer(capa)) capa.addTo(map); }
    });
    actualizarPanelCapasQGIS();
    actualizarBotonVisibilidadCapas();
    estado(todasVisibles ? 'Todas las capas fueron apagadas.' : 'Todas las capas fueron encendidas.', 'green', 3000);
}

function zoomACapa(tabla) {
    const capa = capasCargadas[tabla];
    if (capa?.getBounds) { const bounds = capa.getBounds(); if (bounds.isValid()) map.fitBounds(bounds, {padding:[25,25]}); }
}

function cambiarColorCapa(tabla, color) {
    const capa = capasCargadas[tabla];
    if (!capa) return;
    capa.options.colorCapa = color;
    capa.eachLayer(layer => { if (layer.setStyle) layer.setStyle({ color, fillColor: color }); });
    actualizarPanelCapasQGIS();
}

// ============================================================
// HERRAMIENTAS
// ============================================================

let herramientaActiva = null;
let puntosMedicion = [];
let lineaMedicion = null;
let poligonoMedicion = null;
let capaMediciones = L.featureGroup().addTo(map);
let capaResaltadoBusqueda = L.featureGroup().addTo(map);

function establecerHerramienta(nombre, texto) {
    herramientaActiva = nombre;
    document.querySelectorAll('.herramienta-btn').forEach(btn => btn.classList.remove('activa'));
    const ids = { identificar: 'btn_identificar', distancia: 'btn_medir_distancia', area: 'btn_medir_area' };
    if (ids[nombre]) document.getElementById(ids[nombre])?.classList.add('activa');
    document.getElementById('estado_herramienta').textContent = texto || 'Ninguna';
    const contenedor = map.getContainer();
    contenedor.classList.toggle('cursor-medicion', nombre === 'distancia' || nombre === 'area');
}

function herramientaEsMedicion() { return herramientaActiva === 'distancia' || herramientaActiva === 'area'; }

// --- Búsqueda ---

function alternarBusqueda() {
    const panel = document.getElementById('panel_busqueda');
    panel.classList.toggle('visible');
    if (panel.classList.contains('visible')) document.getElementById('buscar_predio_input').focus();
}

function normalizarTextoBusqueda(valor) {
    return String(valor ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

let resultadosBusqueda = [];
let indiceResultadoBusqueda = -1;

function actualizarControlesBusqueda() {
    const navegacion = document.getElementById('navegacion_busqueda');
    const contador = document.getElementById('contador_busqueda');
    if (!resultadosBusqueda.length) { navegacion.classList.remove('visible'); contador.textContent = '0 de 0'; return; }
    navegacion.classList.add('visible');
    contador.textContent = `${indiceResultadoBusqueda + 1} de ${resultadosBusqueda.length}`;
}

function mostrarResultadoBusqueda(indiceSolicitado) {
    if (!resultadosBusqueda.length) return;
    if (indiceSolicitado < 0) indiceResultadoBusqueda = resultadosBusqueda.length - 1;
    else if (indiceSolicitado >= resultadosBusqueda.length) indiceResultadoBusqueda = 0;
    else indiceResultadoBusqueda = indiceSolicitado;

    const resultado = resultadosBusqueda[indiceResultadoBusqueda];
    const layer = resultado.layer;
    const grupo = capasCargadas[resultado.nombreCapa];
    if (grupo && !map.hasLayer(grupo)) { grupo.addTo(map); actualizarPanelCapasQGIS(); }
    capaResaltadoBusqueda.clearLayers();

    if (layer.getBounds) {
        const bounds = layer.getBounds();
        if (bounds && bounds.isValid()) map.fitBounds(bounds, { padding: [45, 45], maxZoom: 19 });
        if (layer.toGeoJSON) {
            L.geoJSON(layer.toGeoJSON(), {
                style: { color: '#ffff00', weight: 5, fillColor: '#ffff00', fillOpacity: .28 },
                pointToLayer: (_, latlng) => L.circleMarker(latlng, { radius: 11, color: '#ffff00', weight: 4, fillColor: '#ffff00', fillOpacity: .35 })
            }).addTo(capaResaltadoBusqueda);
        }
    } else if (layer.getLatLng) {
        const latlng = layer.getLatLng();
        map.setView(latlng, 19);
        L.circleMarker(latlng, { radius: 11, color: '#ffff00', weight: 4, fillColor: '#ffff00', fillOpacity: .30 }).addTo(capaResaltadoBusqueda);
    }

    setTimeout(() => { if (layer.openPopup) layer.openPopup(); }, 250);
    document.getElementById('resultado_busqueda').textContent = `${resultadosBusqueda.length} coincidencia(s)`;
    actualizarControlesBusqueda();
    estado(`Resultado ${indiceResultadoBusqueda + 1} de ${resultadosBusqueda.length}, capa "${resultado.nombreCapa}".`, 'green');
}

function buscarPredio() {
    const terminoOriginal = document.getElementById('buscar_predio_input').value.trim();
    const resultadoEl = document.getElementById('resultado_busqueda');
    if (!terminoOriginal) { resultadoEl.textContent = 'Escribe un valor.'; resultadosBusqueda = []; indiceResultadoBusqueda = -1; actualizarControlesBusqueda(); return; }
    const termino = normalizarTextoBusqueda(terminoOriginal);
    resultadosBusqueda = [];
    indiceResultadoBusqueda = -1;

    for (const [nombreCapa, grupo] of Object.entries(capasCargadas)) {
        grupo.eachLayer(layer => {
            const feature = layer.feature;
            const propiedades = feature?.properties || {};
            const coincide = Object.entries(propiedades).some(([campo, valor]) =>
                normalizarTextoBusqueda(campo).includes(termino) || normalizarTextoBusqueda(valor).includes(termino)
            );
            if (coincide && (layer.getBounds || layer.getLatLng)) resultadosBusqueda.push({ nombreCapa, layer, propiedades });
        });
    }

    capaResaltadoBusqueda.clearLayers();
    if (!resultadosBusqueda.length) { resultadoEl.textContent = 'Sin resultados.'; actualizarControlesBusqueda(); estado(`No se encontraron registros que contengan "${terminoOriginal}".`, 'orange'); return; }
    indiceResultadoBusqueda = 0;
    actualizarControlesBusqueda();
    mostrarResultadoBusqueda(0);
}

function activarIdentificar() {
    establecerHerramienta('identificar', 'Identificar atributos');
    estado('Haz clic sobre una geometría visible para consultar sus atributos.', 'black');
}

// --- Medición ---

function activarMedicion(tipo) {
    limpiarMediciones(false);
    puntosMedicion = [];
    establecerHerramienta(tipo, tipo === 'distancia' ? 'Medir distancia' : 'Medir área');
    map.doubleClickZoom.disable();
    document.getElementById('estado_medicion').textContent = tipo === 'distancia' ? 'Haz clic para añadir puntos; doble clic para terminar.' : 'Haz clic para dibujar el polígono; doble clic para terminar.';
    estado(tipo === 'distancia' ? 'Medición de distancia activada.' : 'Medición de área activada.', 'black');
}

function formatoDistancia(metros) { return metros >= 1000 ? `${(metros/1000).toFixed(3)} km` : `${metros.toFixed(2)} m`; }

function formatoArea(m2) {
    if (m2 >= 1000000) return `${(m2/1000000).toFixed(3)} km²`;
    if (m2 >= 10000) return `${(m2/10000).toFixed(3)} ha`;
    return `${m2.toFixed(2)} m²`;
}

function calcularDistanciaTotal(puntos) { let total = 0; for (let i = 1; i < puntos.length; i++) total += map.distance(puntos[i-1], puntos[i]); return total; }

function calcularAreaGeodesica(latlngs) {
    if (latlngs.length < 3) return 0;
    const radio = 6378137;
    let area = 0;
    for (let i = 0, j = latlngs.length - 1; i < latlngs.length; j = i++) {
        const p1 = latlngs[j], p2 = latlngs[i];
        area += ((p2.lng - p1.lng) * Math.PI / 180) * (2 + Math.sin(p1.lat * Math.PI / 180) + Math.sin(p2.lat * Math.PI / 180));
    }
    return Math.abs(area * radio * radio / 2);
}

function actualizarDibujoMedicion() {
    if (lineaMedicion) { capaMediciones.removeLayer(lineaMedicion); lineaMedicion = null; }
    if (poligonoMedicion) { capaMediciones.removeLayer(poligonoMedicion); poligonoMedicion = null; }

    if (herramientaActiva === 'distancia') {
        lineaMedicion = L.polyline(puntosMedicion, { color: '#d32f2f', weight: 3, dashArray: '7,5' }).addTo(capaMediciones);
        const total = calcularDistanciaTotal(puntosMedicion);
        document.getElementById('estado_medicion').textContent = puntosMedicion.length > 1 ? formatoDistancia(total) : 'Seleccione otro punto.';
    }

    if (herramientaActiva === 'area') {
        if (puntosMedicion.length >= 2) {
            poligonoMedicion = L.polygon(puntosMedicion, { color: '#7b1fa2', weight: 3, fillColor: '#ba68c8', fillOpacity: .25 }).addTo(capaMediciones);
        }
        const area = calcularAreaGeodesica(puntosMedicion);
        document.getElementById('estado_medicion').textContent = puntosMedicion.length >= 3 ? formatoArea(area) : 'Se requieren al menos 3 puntos.';
    }
}

function finalizarMedicion() {
    if (herramientaActiva !== 'distancia' && herramientaActiva !== 'area') return;
    let resultado = 'Sin resultado';
    if (herramientaActiva === 'distancia') resultado = formatoDistancia(calcularDistanciaTotal(puntosMedicion));
    else resultado = formatoArea(calcularAreaGeodesica(puntosMedicion));
    document.getElementById('estado_medicion').textContent = resultado;
    const ultimo = puntosMedicion[puntosMedicion.length - 1];
    if (ultimo) {
        L.popup({ closeButton: true, autoClose: false, className: 'resultado-medicion-popup' })
            .setLatLng(ultimo).setContent(`<b>Resultado:</b> ${resultado}`).openOn(map);
    }
    establecerHerramienta(null, 'Ninguna');
    map.doubleClickZoom.enable();
    estado(`Medición finalizada: ${resultado}`, 'green');
}

function limpiarMediciones(mostrarMensaje = true) {
    map.closePopup();
    capaMediciones.clearLayers();
    capaResaltadoBusqueda.clearLayers();
    resultadosBusqueda = [];
    indiceResultadoBusqueda = -1;
    actualizarControlesBusqueda();
    const buscarInput = document.getElementById('buscar_predio_input');
    if (buscarInput) buscarInput.value = '';
    const resultadoBusquedaEl = document.getElementById('resultado_busqueda');
    if (resultadoBusquedaEl) resultadoBusquedaEl.textContent = '';
    puntosMedicion = [];
    lineaMedicion = null;
    poligonoMedicion = null;
    limpiarUbicacionReporte();
    modoSeleccionReporte = false;
    modoEditarEstado = false;
    document.getElementById('map').style.cursor = '';
    document.getElementById('btn_editar_estado')?.classList.remove('activa');
    establecerHerramienta(null, 'Ninguna');
    map.doubleClickZoom.enable();
    document.getElementById('estado_medicion').textContent = '—';
    document.getElementById('panel_busqueda').classList.remove('visible');
    document.getElementById('btn_identificar').classList.remove('activa');
    document.getElementById('btn_medir_distancia').classList.remove('activa');
    document.getElementById('btn_medir_area').classList.remove('activa');
    if (mostrarMensaje) estado('Limpieza general realizada.', 'black');
}

function agregarPuntoMedicion(latlng) {
    if (!herramientaEsMedicion() || !latlng) return;
    puntosMedicion.push(latlng);
    L.marker(latlng, { icon: L.divIcon({ className: 'marca-medicion', iconSize: [10, 10] }), interactive: false }).addTo(capaMediciones);
    actualizarDibujoMedicion();
}

// --- Eventos del mapa ---

map.on('mousemove', evento => {
    document.getElementById('coord_x').textContent = evento.latlng.lng.toFixed(6);
    document.getElementById('coord_y').textContent = evento.latlng.lat.toFixed(6);
});

map.on('zoomend', () => {
    document.getElementById('estado_zoom').textContent = map.getZoom();
});

map.on('click', evento => {
    if (!herramientaEsMedicion()) return;
    if (evento.originalEvent?._geocatMedicionProcesada) return;
    agregarPuntoMedicion(evento.latlng);
});

map.on('dblclick', evento => {
    if (herramientaActiva !== 'distancia' && herramientaActiva !== 'area') return;
    L.DomEvent.stop(evento);
    finalizarMedicion();
});

window.addEventListener('resize', () => {
    if (typeof map !== 'undefined') setTimeout(() => map.invalidateSize(), 80);
});

document.getElementById('supabase_url').addEventListener('input', ocultarMensajeLogin);
document.getElementById('supabase_key').addEventListener('input', ocultarMensajeLogin);

// Popup scroll control
map.on('popupopen', evento => {
    const popupElement = evento.popup.getElement();
    if (!popupElement) return;
    const contenido = popupElement.querySelector('.popup-ficha-detalles-contenido');
    if (!contenido) return;
    L.DomEvent.disableScrollPropagation(contenido);
    L.DomEvent.disableClickPropagation(contenido);
    ['wheel','mousewheel','DOMMouseScroll','touchmove'].forEach(tipo => {
        contenido.addEventListener(tipo, e => e.stopPropagation(), { passive: true });
    });
});

document.addEventListener('click', function(evento) {
    const boton = evento.target.closest('.popup-ficha-toggle');
    if (!boton) return;
    evento.preventDefault();
    evento.stopPropagation();
    window.toggleAtributosPopup(boton, evento);
}, true);

// Popup update after toggle
document.addEventListener('click', function(evento) {
    const boton = evento.target.closest('.popup-ficha-toggle');
    if (!boton) return;
    setTimeout(() => {
        const popup = map.getPopup ? map.getPopup() : null;
        if (!popup) return;
        popup.update();
        map.panInside(popup.getLatLng(), { paddingTopLeft: [30, 105], paddingBottomRight: [30, 55] });
    }, 40);
}, true);

// Popup during measurement
map.on('popupopen', evento => {
    if (!herramientaEsMedicion()) return;
    map.closePopup(evento.popup);
});

const activarMedicionOriginal = activarMedicion;
activarMedicion = function(tipo) { map.closePopup(); activarMedicionOriginal(tipo); };

const activarIdentificarOriginal = activarIdentificar;
activarIdentificar = function() {
    puntosMedicion = []; lineaMedicion = null; poligonoMedicion = null;
    map.doubleClickZoom.enable();
    activarIdentificarOriginal();
};

// ============================================================
// SELECTOR DE MAPA BASE
// ============================================================

function alternarMenuMapaBase(evento) {
    if (evento) evento.stopPropagation();
    const boton = document.getElementById('btn_mapa_base');
    const menu = document.getElementById('menu_mapa_base');
    const abrir = !menu.classList.contains('abierto');
    if (!abrir) { menu.classList.remove('abierto'); return; }
    const rect = boton.getBoundingClientRect();
    const anchoMenu = 220, margen = 8;
    let left = rect.left, top = rect.bottom + 6;
    if (left + anchoMenu > window.innerWidth - margen) left = window.innerWidth - anchoMenu - margen;
    if (top + 220 > window.innerHeight - margen) top = rect.top - 220 - 6;
    menu.style.left = `${Math.max(margen, left)}px`;
    menu.style.top = `${Math.max(margen, top)}px`;
    menu.classList.add('abierto');
}

function cerrarMenuMapaBase() { document.getElementById('menu_mapa_base').classList.remove('abierto'); }

function actualizarOpcionMapaBase(tipo) {
    ['callejero','satelite','hibrido','google_satelite','google_hibrido'].forEach(nombre => {
        const boton = document.getElementById(`opcion_base_${nombre}`);
        if (boton) boton.classList.toggle('activa', nombre === tipo);
    });
}

function retirarMapasBase() {
    [mapaBaseCallejero, mapaBaseSatelite, etiquetasHibridas, mapaBaseGoogleSatelite, mapaBaseGoogleHibrido].forEach(capa => {
        if (map.hasLayer(capa)) map.removeLayer(capa);
    });
}

function cambiarMapaBase(tipo) {
    retirarMapasBase();
    if (tipo === 'satelite' || tipo === 'hibrido') avisoSateliteMostrado = false;
    if (tipo === 'satelite') mapaBaseSatelite.addTo(map);
    else if (tipo === 'hibrido') { mapaBaseSatelite.addTo(map); etiquetasHibridas.addTo(map); }
    else if (tipo === 'google_satelite') mapaBaseGoogleSatelite.addTo(map);
    else if (tipo === 'google_hibrido') mapaBaseGoogleHibrido.addTo(map);
    else { mapaBaseCallejero.addTo(map); tipo = 'callejero'; }
    mapaBaseActivo = tipo;
    actualizarOpcionMapaBase(tipo);
    cerrarMenuMapaBase();
    const nombres = { callejero:'Callejero', satelite:'Esri Satélite', hibrido:'Esri Híbrido', google_satelite:'Google Satellite', google_hibrido:'Google Hybrid' };
    if (tipo === 'google_satelite' || tipo === 'google_hibrido') {
        estado(`${nombres[tipo]} activado en modo demostración sin API Key.`, 'orange', 5000);
    } else {
        estado(`Mapa base cambiado a ${nombres[tipo]}.`, 'green', 3000);
    }
}

document.addEventListener('click', evento => {
    const selector = document.querySelector('.selector-mapa-base');
    if (selector && !selector.contains(evento.target)) cerrarMenuMapaBase();
});

// ============================================================
// GOOGLE EARTH
// ============================================================

function abrirGoogleEarth() {
    const centro = map.getCenter();
    const zoom = map.getZoom();
    const altura = Math.max(120, Math.round(40075000 / Math.pow(2, zoom)));
    const url = `https://earth.google.com/web/@${centro.lat.toFixed(7)},${centro.lng.toFixed(7)},${altura}a,35y,0h,0t,0r`;
    window.open(url, '_blank', 'noopener,noreferrer');
    cerrarMenuMapaBase();
    estado('Abriendo la ubicación actual en Google Earth...', 'green', 3500);
}

map.on('overlayadd overlayremove', () => actualizarBotonVisibilidadCapas());

// ============================================================
// CONSULTAS Y REPORTES
// ============================================================

let resultadosConsultaReporte = [];
let capaResultadosConsulta = null;
let nombreReporteActual = 'reporte_geocat.xlsx';

const CAMPOS_AREA_CONSTRUIDA = ['areaconst','area_const','area_construida','area_construccion','area_edificada','area_edif'];
const CAMPOS_BARRIO = ['barrio_sec','barrio_sector','barrio','sector_barrio'];
const CAMPOS_SECTOR = ['sector','sector_cat','sector_catastral','zona','zona_sector'];
const CAMPOS_PIT = ['no_pit'];
const CAMPOS_USO_SUELO = ['uso_genera','uso_general','uso_suelo','uso'];

function alternarPanelConsultas() {
    const panel = document.getElementById('panel_consultas_reportes');
    const abrir = !panel.classList.contains('visible');
    panel.classList.toggle('visible', abrir);
    document.getElementById('btn_consultas')?.classList.toggle('activa', abrir);
    if (abrir) {
        actualizarCapasConsultaReporte();
        actualizarFormularioConsulta();
        document.getElementById('estado_herramienta').textContent = 'Consultas';
    } else {
        document.getElementById('estado_herramienta').textContent = 'Ninguna';
    }
}

function cerrarPanelConsultas() {
    document.getElementById('panel_consultas_reportes').classList.remove('visible');
    document.getElementById('btn_consultas')?.classList.remove('activa');
    document.getElementById('estado_herramienta').textContent = 'Ninguna';
}

function nombresCapasCargadas() {
    return Object.keys(capasCargadas);
}

function llenarSelectCapas(id, nombres) {
    const select = document.getElementById(id);
    if (!select) return;
    select.innerHTML = nombres.length
        ? nombres.map(nombre => `<option value="${escaparAtributoHtml(nombre)}">${escaparHtmlPopup(nombre)}</option>`).join('')
        : '<option value="">No hay capas cargadas</option>';
}

function actualizarCapasConsultaReporte() {
    llenarSelectCapas('capa_consulta_reporte', nombresCapasCargadas());
    cargarOpcionesConsulta();
}

function actualizarFormularioConsulta() { cargarOpcionesConsulta(); }

function obtenerFeaturesCapa(nombreCapa) {
    const capa = capasCargadas[nombreCapa];
    if (!capa) return [];
    const features = [];
    capa.eachLayer(layer => { if (layer.feature) features.push(layer.feature); });
    return features;
}

function buscarCampoPorVariantes(campos, variantes) {
    for (const variante of variantes) {
        const campo = campos.find(nombre => normalizarNombreCampoPopup(nombre) === variante);
        if (campo) return campo;
    }
    return null;
}

function obtenerValoresUnicos(features, campo) {
    return [...new Set(features.map(f => f.properties?.[campo]).filter(valorUtilPopup).map(v => String(v).trim()))].sort((a,b) => a.localeCompare(b,'es'));
}

function cargarOpcionesConsulta() {
    const capa = document.getElementById('capa_consulta_reporte')?.value;
    const selectTipo = document.getElementById('tipo_consulta_reporte');
    const selectValor = document.getElementById('valor_consulta_reporte');
    if (!selectTipo || !selectValor) return;

    if (!capa) {
        selectTipo.innerHTML = '<option value="">Selecciona una capa</option>';
        selectValor.innerHTML = '<option value="">Sin datos</option>';
        cargarFiltroAdicional();
        return;
    }

    const features = obtenerFeaturesCapa(capa);
    if (!features.length) {
        selectTipo.innerHTML = '<option value="">Sin datos en la capa</option>';
        selectValor.innerHTML = '<option value="">Sin datos</option>';
        cargarFiltroAdicional();
        return;
    }

    const campos = Object.keys(features[0].properties || {});
    const esReportes = normalizarNombreCampoPopup(capa).includes('reportes_portal');
    const campoReporte = buscarCampoPorVariantes(campos, ['tipo_reporte']);
    const campoEstado = buscarCampoPorVariantes(campos, ['estado']);

    if (esReportes) {
        const tipoActual = document.getElementById('tipo_consulta_reporte').value;
        selectTipo.innerHTML = `
            <option value="todos_reportes">Todos los reportes</option>
            <option value="tipo_reporte">Por tipo de reporte</option>
        `;
        if (tipoActual === 'tipo_reporte' || tipoActual === 'todos_reportes') selectTipo.value = tipoActual;

        if (selectTipo.value === 'tipo_reporte' && campoReporte) {
            selectValor.innerHTML = obtenerValoresUnicos(features, campoReporte).map(v =>
                `<option value="${escaparAtributoHtml(v)}">${escaparHtmlPopup(v)}</option>`
            ).join('');
        } else {
            selectValor.innerHTML = '<option value="todos">Mostrar todos</option>';
        }
    } else {
        const tipoActual = document.getElementById('tipo_consulta_reporte').value;
        selectTipo.innerHTML = `
            <option value="edificacion">Estado de edificación</option>
            <option value="barrio">Reporte por barrio</option>
            <option value="pit">Reporte por PIT</option>
            <option value="uso_suelo">Reporte por uso de suelo</option>
        `;
        if (['edificacion','barrio','pit','uso_suelo'].includes(tipoActual)) selectTipo.value = tipoActual;

        const tipo = document.getElementById('tipo_consulta_reporte').value;
        if (tipo === 'edificacion') selectValor.innerHTML = '<option value="edificados">Predios edificados</option><option value="vacios">Solares vacíos</option>';
        else if (tipo === 'barrio') { const campo = buscarCampoPorVariantes(campos, CAMPOS_BARRIO); selectValor.innerHTML = campo ? obtenerValoresUnicos(features, campo).map(v => `<option value="${escaparAtributoHtml(v)}">${escaparHtmlPopup(v)}</option>`).join('') : '<option value="">No se encontró Barrio_Sec</option>'; }
        else if (tipo === 'pit') { const campo = buscarCampoPorVariantes(campos, CAMPOS_PIT); selectValor.innerHTML = campo ? obtenerValoresUnicos(features, campo).map(v => `<option value="${escaparAtributoHtml(v)}">${escaparHtmlPopup(v)}</option>`).join('') : '<option value="">No se encontró No_PIT</option>'; }
        else if (tipo === 'uso_suelo') { const campo = buscarCampoPorVariantes(campos, CAMPOS_USO_SUELO); selectValor.innerHTML = campo ? obtenerValoresUnicos(features, campo).map(v => `<option value="${escaparAtributoHtml(v)}">${escaparHtmlPopup(v)}</option>`).join('') : '<option value="">No se encontró Uso_Genera</option>'; }
    }
    cargarFiltroAdicional();
}

function cargarFiltroAdicional() {
    const capa = document.getElementById('capa_consulta_reporte')?.value;
    const select = document.getElementById('filtro_adicional_reporte');
    if (!select) return;
    const features = obtenerFeaturesCapa(capa);
    if (!features.length) { select.innerHTML = '<option value="todos">Todos</option>'; return; }
    const campos = Object.keys(features[0].properties || {});
    const opciones = ['<option value="todos">Todos los resultados</option>'];

    const esReportes = normalizarNombreCampoPopup(capa).includes('reportes_portal');

    if (esReportes) {
        const campoTipo = buscarCampoPorVariantes(campos, ['tipo_reporte']);
        if (campoTipo) {
            obtenerValoresUnicos(features, campoTipo).forEach(valor => {
                const payload = encodeURIComponent(JSON.stringify({ tipo:'tipo_reporte', campo:campoTipo, valor }));
                opciones.push(`<option value="${payload}">Tipo: ${escaparHtmlPopup(valor)}</option>`);
            });
        }
        const campoEstado = buscarCampoPorVariantes(campos, ['estado']);
        if (campoEstado) {
            obtenerValoresUnicos(features, campoEstado).forEach(valor => {
                const payload = encodeURIComponent(JSON.stringify({ tipo:'estado', campo:campoEstado, valor }));
                opciones.push(`<option value="${payload}">Estado: ${escaparHtmlPopup(valor)}</option>`);
            });
        }
    } else {
        const campoSector = buscarCampoPorVariantes(campos, CAMPOS_SECTOR);
        const campoBarrio = buscarCampoPorVariantes(campos, CAMPOS_BARRIO);
        if (campoSector) {
            obtenerValoresUnicos(features, campoSector).forEach(valor => {
                const payload = encodeURIComponent(JSON.stringify({ tipo:'sector', campo:campoSector, valor }));
                opciones.push(`<option value="${payload}">Sector: ${escaparHtmlPopup(valor)}</option>`);
            });
        }
        if (campoBarrio) {
            obtenerValoresUnicos(features, campoBarrio).forEach(valor => {
                const payload = encodeURIComponent(JSON.stringify({ tipo:'barrio', campo:campoBarrio, valor }));
                opciones.push(`<option value="${payload}">Barrio: ${escaparHtmlPopup(valor)}</option>`);
            });
        }
    }
    select.innerHTML = opciones.join('');
}

document.addEventListener('change', evento => { if (evento.target?.id === 'capa_consulta_reporte') cargarOpcionesConsulta(); });

function resaltarResultadosConsulta(features) {
    if (capaResultadosConsulta) map.removeLayer(capaResultadosConsulta);
    const esPunto = features.some(f => f.geometry?.type === 'Point');
    capaResultadosConsulta = L.geoJSON({ type:'FeatureCollection', features }, {
        style: esPunto ? null : { color:'#ffea00', weight:4, fillColor:'#fff176', fillOpacity:.5 },
        pointToLayer: esPunto ? function(feature, latlng) {
            const tipo = feature.properties?.tipo_reporte || 'Reporte';
            return L.circleMarker(latlng, {
                radius: 8, color: '#ef4444', weight: 2.5,
                fillColor: '#ef4444', fillOpacity: 0.85
            }).bindPopup(`<b>${escaparHtmlPopup(tipo)}</b><br>${escaparHtmlPopup(feature.properties?.comentario || '')}<br><small>${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}</small>`);
        } : undefined
    }).addTo(map);
    const bounds = capaResultadosConsulta.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, {padding:[25,25]});
}

function valorNumericoConsulta(valor) {
    if (valor === null || valor === undefined || valor === '') return 0;
    if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
    let texto = String(valor).trim().replace(/\s*m2|\s*m²/gi,'');
    if (texto.includes(',') && texto.includes('.')) texto = texto.replace(/\./g,'').replace(',','.');
    else if (texto.includes(',')) texto = texto.replace(',','.');
    const numero = Number(texto);
    return Number.isFinite(numero) ? numero : 0;
}

function aplicarFiltroAdicional(features) {
    const valorFiltro = document.getElementById('filtro_adicional_reporte')?.value;
    if (!valorFiltro || valorFiltro === 'todos') return features;
    try {
        const filtro = JSON.parse(decodeURIComponent(valorFiltro));
        return features.filter(feature => String(feature.properties?.[filtro.campo] ?? '').trim() === String(filtro.valor).trim());
    } catch (error) { console.warn('Filtro adicional inválido:', error); return features; }
}

function ejecutarConsultaReporte() {
    const tipo = document.getElementById('tipo_consulta_reporte').value;
    const capa = document.getElementById('capa_consulta_reporte').value;
    const valor = document.getElementById('valor_consulta_reporte').value;
    const resumen = document.getElementById('resumen_consulta_reporte');
    resultadosConsultaReporte = [];
    document.getElementById('btn_descargar_reporte').disabled = true;
    resumen.className = 'resumen-consulta-reporte';
    resumen.textContent = 'Procesando consulta...';

    try {
        const features = obtenerFeaturesCapa(capa);
        if (!features.length) throw new Error('La capa seleccionada no contiene registros cargados.');
        const campos = Object.keys(features[0].properties || {});
        let resultadosBase = [], descripcion = '';

        if (tipo === 'todos_reportes') {
            resultadosBase = features;
            const total = features.length;
            descripcion = `reporte(s) encontrados (${total})`;
            nombreReporteActual = 'todos_los_reportes.xlsx';
        } else if (tipo === 'tipo_reporte') {
            const campo = buscarCampoPorVariantes(campos, ['tipo_reporte']);
            if (!campo) throw new Error('No se encontró el campo tipo_reporte.');
            resultadosBase = features.filter(f => String(f.properties?.[campo] ?? '').trim() === String(valor).trim());
            descripcion = `reporte(s) de tipo "${valor}"`;
            nombreReporteActual = `reportes_${normalizarNombreCampoPopup(valor)}.xlsx`;
        } else if (tipo === 'edificacion') {
            const campoArea = buscarCampoPorVariantes(campos, CAMPOS_AREA_CONSTRUIDA);
            if (!campoArea) throw new Error('No se encontró el campo AreaConst en la capa.');
            if (valor === 'edificados') { resultadosBase = features.filter(f => valorNumericoConsulta(f.properties?.[campoArea]) > 0); descripcion = 'predio(s) edificados'; nombreReporteActual = 'predios_edificados.xlsx'; }
            else { resultadosBase = features.filter(f => valorNumericoConsulta(f.properties?.[campoArea]) === 0); descripcion = 'solar(es) vacío(s)'; nombreReporteActual = 'solares_vacios.xlsx'; }
        }
        if (tipo === 'barrio') {
            const campo = buscarCampoPorVariantes(campos, CAMPOS_BARRIO);
            if (!campo) throw new Error('No se encontró el campo Barrio_Sec.');
            resultadosBase = features.filter(f => String(f.properties?.[campo] ?? '').trim() === String(valor).trim());
            descripcion = `predio(s) del barrio "${valor}"`;
            nombreReporteActual = `reporte_barrio_${normalizarNombreCampoPopup(valor)}.xlsx`;
        }
        if (tipo === 'pit') {
            const campo = buscarCampoPorVariantes(campos, CAMPOS_PIT);
            if (!campo) throw new Error('No se encontró el campo No_PIT.');
            resultadosBase = features.filter(f => String(f.properties?.[campo] ?? '').trim() === String(valor).trim());
            descripcion = `predio(s) del PIT "${valor}"`;
            nombreReporteActual = `reporte_pit_${normalizarNombreCampoPopup(valor)}.xlsx`;
        }
        if (tipo === 'uso_suelo') {
            const campo = buscarCampoPorVariantes(campos, CAMPOS_USO_SUELO);
            if (!campo) throw new Error('No se encontró el campo Uso_Genera.');
            resultadosBase = features.filter(f => String(f.properties?.[campo] ?? '').trim() === String(valor).trim());
            descripcion = `predio(s) con uso de suelo "${valor}"`;
            nombreReporteActual = `reporte_uso_suelo_${normalizarNombreCampoPopup(valor)}.xlsx`;
        }

        resultadosConsultaReporte = aplicarFiltroAdicional(resultadosBase);
        resaltarResultadosConsulta(resultadosConsultaReporte);
        resumen.classList.add('ok');
        resumen.textContent = `${resultadosConsultaReporte.length} ${descripcion}.`;
        document.getElementById('btn_descargar_reporte').disabled = resultadosConsultaReporte.length === 0;
        document.getElementById('estado_herramienta').textContent = 'Consulta';
        document.getElementById('estado_medicion').textContent = `${resultadosConsultaReporte.length} resultado(s)`;
    } catch (error) {
        console.error(error);
        resumen.classList.add('error');
        resumen.textContent = error.message || 'No fue posible ejecutar la consulta.';
    }
}

function descargarReporteExcel() {
    if (!resultadosConsultaReporte.length) { estado('No hay resultados para exportar.', 'orange', 3500); return; }
    const filas = resultadosConsultaReporte.map((feature, indice) => ({ N: indice + 1, ...feature.properties }));
    const hoja = XLSX.utils.json_to_sheet(filas);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Resultados');
    XLSX.writeFile(libro, nombreReporteActual);
}

function limpiarConsultaReporte() {
    resultadosConsultaReporte = [];
    if (capaResultadosConsulta) { map.removeLayer(capaResultadosConsulta); capaResultadosConsulta = null; }
    const resumen = document.getElementById('resumen_consulta_reporte');
    resumen.className = 'resumen-consulta-reporte';
    resumen.textContent = 'Selecciona una capa y configura la consulta.';
    document.getElementById('btn_descargar_reporte').disabled = true;
    if (document.getElementById('estado_herramienta').textContent === 'Consulta') {
        document.getElementById('estado_herramienta').textContent = 'Ninguna';
    }
    document.getElementById('estado_medicion').textContent = '—';
}

// ============================================================
// REPORTES CIUDADANOS
// ============================================================

let marcadorReporte = null;
let capaReportes = null;
let modoSeleccionReporte = false;

function alternarPanelReportes() {
    const panel = document.getElementById('panel_reportes');
    const abrir = !panel.classList.contains('visible');
    panel.classList.toggle('visible', abrir);
    document.getElementById('btn_reportes')?.classList.toggle('activa', abrir);
    if (abrir) {
        modoSeleccionReporte = true;
        estado('Haz clic en el mapa para marcar la ubicación del reporte.', 'black');
        document.getElementById('map').style.cursor = 'crosshair';
    } else {
        cerrarPanelReportes();
    }
}

function cerrarPanelReportes() {
    document.getElementById('panel_reportes').classList.remove('visible');
    document.getElementById('btn_reportes')?.classList.remove('activa');
    modoSeleccionReporte = false;
    document.getElementById('map').style.cursor = '';
}

function mostrarCoordenadasReporte(lat, lng) {
    const el = document.getElementById('coordenadas_reporte');
    el.textContent = `Lat: ${lat.toFixed(6)} — Lng: ${lng.toFixed(6)}`;
    el.classList.add('marcada');
}

function limpiarUbicacionReporte() {
    if (marcadorReporte) { map.removeLayer(marcadorReporte); marcadorReporte = null; }
    const el = document.getElementById('coordenadas_reporte');
    el.textContent = 'Sin ubicación seleccionada';
    el.classList.remove('marcada');
}

function colocarMarcadorReporte(latlng) {
    limpiarUbicacionReporte();
    marcadorReporte = L.marker(latlng, {
        icon: L.divIcon({ className: 'marca-medicion marcador-reporte', iconSize: [14, 14] }),
        interactive: false
    }).addTo(map);
    mostrarCoordenadasReporte(latlng.lat, latlng.lng);
}

function usarUbicacionGPS() {
    if (!navigator.geolocation) {
        estado('Tu navegador no soporta geolocalización.', 'red');
        return;
    }
    estado('Obteniendo tu ubicación GPS...', 'black', 4000);
    navigator.geolocation.getCurrentPosition(
        function(pos) {
            const latlng = L.latLng(pos.coords.latitude, pos.coords.longitude);
            map.setView(latlng, 16);
            colocarMarcadorReporte(latlng);
            estado('Ubicación GPS registrada.', 'green', 3000);
        },
        function(err) {
            estado('No se pudo obtener la ubicación: ' + err.message, 'red', 6000);
        },
        { enableHighAccuracy: true, timeout: 10000 }
    );
}

map.on('click', function(e) {
    if (!modoSeleccionReporte) return;
    colocarMarcadorReporte(e.latlng);
});

async function enviarReporte() {
    const tipo = document.getElementById('tipo_reporte_select').value;
    const comentario = document.getElementById('comentario_reporte').value.trim();
    const resumen = document.getElementById('resumen_reporte');

    if (!tipo) {
        resumen.className = 'resumen-consulta-reporte error';
        resumen.textContent = 'Debes seleccionar un tipo de reporte.';
        return;
    }
    if (!comentario) {
        resumen.className = 'resumen-consulta-reporte error';
        resumen.textContent = 'Debes escribir un comentario para el reporte.';
        return;
    }
    if (!marcadorReporte) {
        resumen.className = 'resumen-consulta-reporte error';
        resumen.textContent = 'Debes marcar una ubicación en el mapa.';
        return;
    }

    const lat = marcadorReporte.getLatLng().lat;
    const lng = marcadorReporte.getLatLng().lng;
    const supabaseUrl = document.getElementById('supabase_url').value.trim().replace(/\/+$/, '');
    const supabaseKey = document.getElementById('supabase_key').value.trim();

    if (!supabaseUrl || !supabaseKey) {
        resumen.className = 'resumen-consulta-reporte error';
        resumen.textContent = 'No hay conexión a Supabase. Conéctate primero.';
        return;
    }

    const wkt = `SRID=4326;POINT(${lng} ${lat})`;

    const registro = {
        tipo_reporte: tipo,
        comentario: comentario,
        ubicacion: wkt,
        estado: 'pendiente'
    };

    resumen.className = 'resumen-consulta-reporte';
    resumen.textContent = 'Enviando reporte...';
    document.getElementById('btn_enviar_reporte').disabled = true;

    try {
        const respuesta = await fetch(`${supabaseUrl}/rest/v1/reportes_portal`, {
            method: 'POST',
            headers: headersSupabase(supabaseKey),
            body: JSON.stringify(registro),
            cache: 'no-store'
        });

        if (!respuesta.ok) {
            const detalle = await respuesta.text();
            throw new Error(detalle);
        }

        if (!capaReportes) {
            capaReportes = L.layerGroup().addTo(map);
        }
        L.circleMarker([lat, lng], {
            radius: 7,
            color: '#ef4444',
            weight: 2.5,
            fillColor: '#ef4444',
            fillOpacity: 0.85
        }).bindPopup(`<b>${escaparHtmlPopup(tipo)}</b><br>${escaparHtmlPopup(comentario)}<br><small>${lat.toFixed(6)}, ${lng.toFixed(6)}</small>`).addTo(capaReportes);

        resumen.className = 'resumen-consulta-reporte ok';
        resumen.textContent = `Reporte enviado correctamente (${tipo}).`;
        estado('Reporte guardado en la base de datos.', 'green', 5000);

        document.getElementById('tipo_reporte_select').value = '';
        document.getElementById('comentario_reporte').value = '';
        limpiarUbicacionReporte();
    } catch (err) {
        resumen.className = 'resumen-consulta-reporte error';
        resumen.textContent = 'Error al enviar: ' + err.message;
        estado('Error al enviar el reporte.', 'red');
    } finally {
        document.getElementById('btn_enviar_reporte').disabled = false;
    }
}

function limpiarFormularioReporte() {
    document.getElementById('tipo_reporte_select').value = '';
    document.getElementById('comentario_reporte').value = '';
    limpiarUbicacionReporte();
    const resumen = document.getElementById('resumen_reporte');
    resumen.className = 'resumen-consulta-reporte';
    resumen.textContent = 'Selecciona tipo, ubicación y escribe un comentario.';
}

// ============================================================
// EDITAR ESTADO DE REPORTES
// ============================================================

let modoEditarEstado = false;

function activarEditarEstado() {
    modoEditarEstado = !modoEditarEstado;
    const btn = document.getElementById('btn_editar_estado');
    btn?.classList.toggle('activa', modoEditarEstado);
    document.getElementById('map').style.cursor = modoEditarEstado ? 'pointer' : '';
    establecerHerramienta(modoEditarEstado ? 'editar_estado' : null, modoEditarEstado ? 'Editar estado' : 'Ninguna');
    if (modoEditarEstado) {
        estado('Haz clic sobre un punto de reporte para cambiar su estado.', 'black');
    } else {
        map.closePopup();
    }
}

function reporteCercaDe(latlng, radio = 20) {
    const capa = capasCargadas['reportes_portal'];
    if (!capa) return null;
    let masCercano = null;
    let menorDist = Infinity;
    capa.eachLayer(layer => {
        if (!layer.getLatLng) return;
        const d = latlng.distanceTo(layer.getLatLng());
        if (d < menorDist) { menorDist = d; masCercano = layer; }
    });
    return menorDist <= radio ? masCercano : null;
}

map.on('click', function(e) {
    if (!modoEditarEstado) return;
    const layer = reporteCercaDe(e.latlng);
    if (!layer) { estado('No hay un reporte cerca. Haz clic sobre un punto de reporte.', 'orange', 3000); return; }
    const props = layer.feature?.properties;
    if (!props?.id) { estado('Reporte sin identificador.', 'red'); return; }
    const estados = ['Pendiente', 'En trámite', 'Atendido/Resuelto'];
    const actual = estados.includes(props.estado) ? props.estado : 'Pendiente';
    const opciones = estados.map(e => `<option value="${e}"${e === actual ? ' selected' : ''}>${e}</option>`).join('');
    layer.bindPopup(`
        <div style="min-width:220px">
            <b>${escaparHtmlPopup(props.tipo_reporte || 'Reporte')}</b><br>
            <small>${escaparHtmlPopup(props.comentario || '')}</small>
            <hr style="margin:8px 0;border:none;border-top:1px solid var(--border)">
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Estado:</label>
            <select id="edit_estado_select" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:13px">${opciones}</select>
            <button onclick="guardarEstadoReporte('${props.id}')" style="width:100%;margin-top:8px;padding:7px;background:var(--primary);color:#fff;border:none;border-radius:4px;font-weight:600;cursor:pointer">Guardar</button>
        </div>
    `, { maxWidth: 300, minWidth: 220 }).openOn(map);
});

async function guardarEstadoReporte(id) {
    const nuevoEstado = document.getElementById('edit_estado_select')?.value;
    if (!nuevoEstado) return;
    const supabaseUrl = document.getElementById('supabase_url').value.trim().replace(/\/+$/, '');
    const supabaseKey = document.getElementById('supabase_key').value.trim();
    if (!supabaseUrl || !supabaseKey) { estado('No hay conexión a Supabase.', 'red'); return; }
    try {
        const r = await fetch(`${supabaseUrl}/rest/v1/reportes_portal?id=eq.${id}`, {
            method: 'PATCH',
            headers: headersSupabase(supabaseKey),
            body: JSON.stringify({ estado: nuevoEstado }),
            cache: 'no-store'
        });
        if (!r.ok) throw new Error(await r.text());
        const capa = capasCargadas['reportes_portal'];
        if (capa) {
            capa.eachLayer(layer => {
                if (layer.feature?.properties?.id === id) {
                    layer.feature.properties.estado = nuevoEstado;
                    if (layer.getPopup()) {
                        const p = layer.feature.properties;
                        layer.unbindPopup();
                        layer.bindPopup(crearPopupFormateado(p, 'reportes_portal'), {
                            maxWidth: 420, minWidth: 290, autoPan: true,
                            autoPanPaddingTopLeft: [20, 95], autoPanPaddingBottomRight: [20, 45], keepInView: true
                        });
                    }
                }
            });
        }
        map.closePopup();
        modoEditarEstado = false;
        document.getElementById('btn_editar_estado')?.classList.remove('activa');
        document.getElementById('map').style.cursor = '';
        establecerHerramienta(null, 'Ninguna');
        estado(`Estado actualizado a "${nuevoEstado}".`, 'green', 4000);
    } catch (err) {
        estado('Error al guardar: ' + err.message, 'red');
    }
}

// ============================================================
// AUTO-CONEXIÓN desde variables de entorno
// ============================================================

(function autoConectar() {
    if (typeof CONFIG_SUPABASE !== 'undefined' && CONFIG_SUPABASE.url && CONFIG_SUPABASE.key) {
        var urlEl = document.getElementById('supabase_url');
        var keyEl = document.getElementById('supabase_key');
        if (urlEl && keyEl) {
            urlEl.value = CONFIG_SUPABASE.url;
            keyEl.value = CONFIG_SUPABASE.key;
            setTimeout(function() { descubrirTablas(); }, 400);
        }
    }
})();
