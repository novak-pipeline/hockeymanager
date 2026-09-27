"""
Tiny mesh-building kit for the athlete scripts. Everything is authored in
RENDERER space (feet, +Y up, +Z front, +X the player's left) and converted to
Blender space once, when the final object is created.

A Part is a list of verts (+ per-vertex bone weights) and faces (+ per-corner
UVs and a material ROLE). Parts are merged into ONE Blender mesh; each role is
a material slot ("role:jersey", "role:pants", …). The renderer reads the role
from the material name and the slot-local UVs from TEXCOORD_0.
"""

import math
import bpy
import bmesh
from mathutils import Vector, Matrix

from rig import r2b

# UV v-ranges inside one jersey-atlas slot (textures.ts ATLAS_REGIONS)
REGION = dict(torso=(0.42, 1.0), sleeve=(0.26, 0.41), sock=(0.1, 0.25), white=(0.0, 0.08))
WHITE_UV = (0.5, 0.04)

ROLES = ['jersey', 'pants', 'helmet', 'visor', 'gloves', 'skin', 'boot', 'steel', 'stick', 'tape', 'tapeW',
         'pad', 'padTrim', 'cage', 'mask']

# preview colours for the .blend (the renderer recolours from the kit)
ROLE_PREVIEW = dict(
    jersey=(0.75, 0.08, 0.1), pants=(0.35, 0.04, 0.05), helmet=(0.35, 0.04, 0.05), visor=(0.1, 0.13, 0.16),
    gloves=(0.35, 0.04, 0.05), skin=(0.85, 0.62, 0.48), boot=(0.05, 0.05, 0.06), steel=(0.75, 0.78, 0.82),
    stick=(0.06, 0.06, 0.07), tape=(0.04, 0.04, 0.045), tapeW=(0.9, 0.9, 0.9), pad=(0.93, 0.93, 0.9),
    padTrim=(0.75, 0.08, 0.1), cage=(0.15, 0.16, 0.18), mask=(0.8, 0.8, 0.8),
)


def smooth(e0, e1, x):
    if e1 == e0:
        return 1.0 if x >= e1 else 0.0
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


class Part:
    def __init__(self, name):
        self.name = name
        self.v = []       # Vector (renderer space)
        self.w = []       # dict bone -> weight
        self.f = []       # tuple of vertex indices
        self.uv = []      # tuple of (u, v) per corner
        self.role = []    # role per face

    def vert(self, p, w):
        self.v.append(Vector(p))
        self.w.append(dict(w))
        return len(self.v) - 1

    def face(self, idx, uvs, role):
        self.f.append(tuple(idx))
        self.uv.append(tuple(uvs))
        self.role.append(role)

    def transform(self, fn):
        self.v = [Vector(fn(p)) for p in self.v]
        return self

    def reweight(self, fn):
        self.w = [dict(fn(p)) for p in self.v]
        return self

    def set_role(self, role):
        self.role = [role] * len(self.f)
        return self


def rigid(bone):
    return lambda p: {bone: 1.0}


# ── primitives ─────────────────────────────────────────────────────────────

def loft(part, rings, role, weights, uv_region=None, cap_start=False, cap_end=False, u_offset=0.0):
    """
    rings: list of lists of Vector (all rings the same length n, closed loops).
    Builds quads between consecutive rings with a duplicated seam column so the
    UVs wrap cleanly (u = k/n + u_offset, v = ring param 0..1 along the rings,
    mapped into uv_region=(v0, v1) of the atlas slot, or the white strip).
    """
    n = len(rings[0])
    m = len(rings)
    base = len(part.v)
    for ring in rings:
        for k in range(n):
            part.vert(ring[k], weights(ring[k]))
    # cumulative length along the rings' centroids → v
    cents = [sum(r, Vector()) / n for r in rings]
    acc = [0.0]
    for i in range(1, m):
        acc.append(acc[-1] + (cents[i] - cents[i - 1]).length)
    tot = acc[-1] or 1.0

    def uvof(i, k):
        if uv_region is None:
            return WHITE_UV
        v0, v1 = uv_region
        return (k / n + u_offset, v0 + (acc[i] / tot) * (v1 - v0))

    for i in range(m - 1):
        for k in range(n):
            k2 = (k + 1) % n
            a = base + i * n + k
            b = base + i * n + k2
            c = base + (i + 1) * n + k2
            d = base + (i + 1) * n + k
            ku2 = k + 1  # unwrapped u for the seam column
            part.face((a, b, c, d), (uvof(i, k), uvof(i, ku2), uvof(i + 1, ku2), uvof(i + 1, k)), role)
    for cap, ri, rev in ((cap_start, 0, True), (cap_end, m - 1, False)):
        if not cap:
            continue
        c = cents[ri]
        ci = part.vert(c, weights(c))
        for k in range(n):
            a = base + ri * n + k
            b = base + ri * n + (k + 1) % n
            uva = uvof(ri, k)
            uvb = uvof(ri, k + 1)
            uvc = (uva[0], uva[1])
            if rev:
                part.face((ci, b, a), (uvc, uvb, uva), role)
            else:
                part.face((ci, a, b), (uvc, uva, uvb), role)
    return part


def ring(center, ax_u, ax_v, ru, rv, n, phase=0.0, power=2.0, shape=None):
    """Superellipse ring. ax_u/ax_v are unit axes; k=0 lies along +ax_v (the 'front')."""
    out = []
    for k in range(n):
        a = phase + 2 * math.pi * k / n
        s, c = math.sin(a), math.cos(a)
        # superellipse: |x|^p + |y|^p = 1
        e = 2.0 / power
        x = math.copysign(abs(s) ** e, s)
        y = math.copysign(abs(c) ** e, c)
        rr_u, rr_v = ru, rv
        if shape:
            rr_u, rr_v = shape(a, ru, rv)
        out.append(Vector(center) + Vector(ax_u) * (x * rr_u) + Vector(ax_v) * (y * rr_v))
    return out


def frame_for(direction):
    """Two unit axes perpendicular to `direction` (u ~ +X-ish, v ~ +Z-ish)."""
    d = Vector(direction).normalized()
    ref = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
    u = ref.cross(d).normalized()
    v = d.cross(u).normalized()
    return u, v


def rounded_box(part, center, size, role, weights, radius=0.05, segs=2, rot=None, uv_region=None):
    """A bevelled box (bmesh), appended as quads. size = full extents (x, y, z)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    if radius > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(radius, min(size) * 0.49), segments=segs,
                        profile=0.5, affect='EDGES', clamp_overlap=True)
    _append_bm(part, bm, center, role, weights, rot)
    bm.free()


def ellipsoid(part, center, radii, role, weights, n_u=16, n_v=10, rot=None, keep=None):
    """UV-sphere ellipsoid. keep(p_local) → False drops that face (cut-outs)."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=n_u, v_segments=n_v, radius=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * radii[0], v.co.y * radii[1], v.co.z * radii[2]))
    if keep:
        kill = [f for f in bm.faces if not keep(f.calc_center_median())]
        bmesh.ops.delete(bm, geom=kill, context='FACES')
    _append_bm(part, bm, center, role, weights, rot)
    bm.free()


def _append_bm(part, bm, center, role, weights, rot):
    """bmesh verts are built in a local frame where bmesh's (x, y, z) = renderer (x, y, z)."""
    base = len(part.v)
    idx = {}
    for v in bm.verts:
        p = Vector(v.co)
        if rot is not None:
            p = rot @ p
        p = p + Vector(center)
        idx[v.index] = part.vert(p, weights(p))
    bm.verts.index_update()
    for f in bm.faces:
        ids = [idx[v.index] for v in f.verts]
        part.face(ids, [WHITE_UV] * len(ids), role)
    return base


def from_object_eval(obj):
    """Evaluated (modifier-applied) mesh of a helper object, in renderer space."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = ev.to_mesh()
    verts = [Vector((v.co.x, v.co.y, v.co.z)) for v in me.vertices]
    faces = [tuple(p.vertices) for p in me.polygons]
    ev.to_mesh_clear()
    return verts, faces


def skin_shape(name, nodes, edges, subsurf=2, branch_smooth=0.6):
    """
    Build a continuous organic tube-network with Blender's Skin modifier.
    nodes: list of (renderer-space point, radius) ; edges: index pairs.
    Returns (verts, faces) in renderer space.
    """
    me = bpy.data.meshes.new(name + '_skel')
    me.from_pydata([tuple(p) for p, _ in nodes], edges, [])
    ob = bpy.data.objects.new(name + '_skel', me)
    bpy.context.scene.collection.objects.link(ob)
    sk = ob.modifiers.new('skin', 'SKIN')
    sk.branch_smoothing = branch_smooth
    sk.use_smooth_shade = True
    for i, (_, r) in enumerate(nodes):
        rv = me.skin_vertices[0].data[i]
        rv.radius = (r, r) if not isinstance(r, tuple) else r
        rv.use_root = (i == 0)
    if subsurf:
        ss = ob.modifiers.new('sub', 'SUBSURF')
        ss.levels = subsurf
        ss.render_levels = subsurf
    verts, faces = from_object_eval(ob)
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    return verts, faces


# ── final assembly ─────────────────────────────────────────────────────────

def ensure_materials():
    mats = {}
    for role in ROLES:
        name = 'role:' + role
        m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        col = ROLE_PREVIEW[role]
        m.diffuse_color = (col[0], col[1], col[2], 1)
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        if bsdf:
            bsdf.inputs['Base Color'].default_value = (col[0], col[1], col[2], 1)
            bsdf.inputs['Roughness'].default_value = 0.6
        mats[role] = m
    return mats


def build_object(name, parts, bone_names):
    verts, faces, uvs, roles, weights = [], [], [], [], []
    for p in parts:
        base = len(verts)
        verts += [r2b(v) for v in p.v]
        weights += p.w
        for f, uv, role in zip(p.f, p.uv, p.role):
            faces.append(tuple(i + base for i in f))
            uvs.append(uv)
            roles.append(role)
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.validate(clean_customdata=False)
    uvl = me.uv_layers.new(name='UVMap')
    li = 0
    for poly, uv in zip(me.polygons, uvs):
        for k, loop in enumerate(range(poly.loop_start, poly.loop_start + poly.loop_total)):
            uvl.data[loop].uv = uv[k] if k < len(uv) else WHITE_UV
    mats = ensure_materials()
    used = []
    for r in ROLES:
        if r in roles:
            used.append(r)
            me.materials.append(mats[r])
    for poly, r in zip(me.polygons, roles):
        poly.material_index = used.index(r)
        poly.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    groups = {b: ob.vertex_groups.new(name=b) for b in bone_names}
    for i, w in enumerate(weights):
        tot = sum(x for x in w.values() if x > 1e-4)
        top = sorted(((b, x) for b, x in w.items() if x > 1e-4), key=lambda t: -t[1])[:4]
        tot = sum(x for _, x in top) or 1.0
        for b, x in top:
            groups[b].add([i], x / tot, 'REPLACE')
    return ob
