"""Final technical control: evaluate color/roughness on reduced positions."""
from pathlib import Path
root = Path(__file__).parent
baseline = root.parents[1]/'surface-study-2026-09-21/bake.py'
bake = baseline.read_text()
old = 'started=time.perf_counter();bpy.ops.object.bake(type=bake_type)'
assert old in bake
bake = bake.replace(old, '''started=time.perf_counter()
    if channel in {'basecolor', 'roughness'}:
        # A continuous object-space source shader can be evaluated at the
        # reduced surface directly; reserve high-to-low projection for normals.
        direct=high.data.materials[0].copy()
        low.data.materials[0]=direct
        target_node=direct.node_tree.nodes.new('ShaderNodeTexImage');target_node.image=image
        direct.node_tree.nodes.active=target_node
        high.select_set(False);high.hide_render=True
        scene.render.bake.use_selected_to_active=False
        bpy.ops.object.bake(type=bake_type)
        low.data.materials[0]=material
        scene.render.bake.use_selected_to_active=True
        high.hide_render=False;high.select_set(True)
    else:
        bpy.ops.object.bake(type=bake_type)''')
code = (root/'transfer-resolved.py').read_text()
code = code.replace("/'transfer';OUT.mkdir", "/'transfer-target-field';OUT.mkdir")
code = code.replace("code=(BASELINE/'bake.py').read_text()", 'code=PATCHED_BAKE')
exec(compile(code, str(Path(__file__)), 'exec'), {'__file__': __file__, 'PATCHED_BAKE': bake})
views = (root/'transfer-views.py').read_text()
views = views.replace("folder = root/'transfer/a'", "folder = root/'transfer-target-field/a'")
exec(compile(views, str(Path(__file__)), 'exec'), {'__file__': __file__})
