"""Diagnose source-to-bake color difference without altering retained assets."""
from pathlib import Path
root = Path(__file__).parent
code = (root/'transfer-views.py').read_text()
code = code.replace("views = [('walking', (.15, -1.10, 1.65), 47), ('grazing', (1.25, -1.55, .20), 52)]",
                    "views = [('walking-albedo', (.15, -1.10, 1.65), 47)]")
code = code.replace("arrays = {}", """for group in groups.values():
    for ob in group:
        material = ob.data.materials[0].copy()
        ob.data.materials[0] = material
        nodes, links = material.node_tree.nodes, material.node_tree.links
        color = nodes['Principled BSDF'].inputs['Base Color'].links[0].from_socket
        emission = nodes.new('ShaderNodeEmission')
        links.new(color, emission.inputs['Color'])
        links.new(emission.outputs[0], nodes['Material Output'].inputs['Surface'])
arrays = {}""")
code = code.replace("folder/'matched-views.json'", "folder/'color-diagnostic.json'")
exec(compile(code, str(Path(__file__)), 'exec'), {'__file__': __file__})
