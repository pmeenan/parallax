"""Final-cycle metric limestone field; used by build2.py, not a standalone job."""
def stone_material(seed, texture_offset):
    mat = template.copy()
    mat.name = f'Broad limestone correlated field {seed}'
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bs = nodes.get('Principled BSDF')
    coord = next(node for node in nodes if node.type == 'TEX_COORD')
    mapping = next(node for node in nodes if node.type == 'VECT_MATH' and node.operation == 'MULTIPLY_ADD')
    seeded = nodes.new('ShaderNodeVectorMath')
    seeded.operation = 'ADD'
    seeded.inputs[1].default_value = ((seed % 997)*.017, (seed % 613)*.023, (seed % 379)*.031)
    links.new(coord.outputs['Object'], seeded.inputs[0])
    warp = nodes.new('ShaderNodeTexNoise')
    warp.inputs['Scale'].default_value = 5.5
    warp.inputs['Detail'].default_value = 2
    warp.inputs['Roughness'].default_value = .55
    links.new(seeded.outputs[0], warp.inputs['Vector'])
    displacement = nodes.new('ShaderNodeVectorMath')
    displacement.operation = 'MULTIPLY_ADD'
    displacement.inputs[1].default_value = (.11, .11, .04)
    displacement.inputs[2].default_value = (-.055, -.055, -.02)
    links.new(warp.outputs['Color'], displacement.inputs[0])
    warped = nodes.new('ShaderNodeVectorMath')
    warped.operation = 'ADD'
    links.new(coord.outputs['Object'], warped.inputs[0])
    links.new(displacement.outputs[0], warped.inputs[1])
    # A shared metric warp drives all three retained synthetic channels. It
    # changes local adjacency and mineral boundaries, not just their origin.
    links.new(warped.outputs[0], mapping.inputs[0])
    mapping.inputs[2].default_value = ((seed % 97)/97, (seed % 79)/79, .5-.04/.45)
    old_color = bs.inputs['Base Color'].links[0].from_socket
    broad = nodes.new('ShaderNodeTexNoise')
    broad.inputs['Scale'].default_value = 3.2
    broad.inputs['Detail'].default_value = 2.3
    broad.inputs['Roughness'].default_value = .65
    links.new(seeded.outputs[0], broad.inputs['Vector'])
    tint = nodes.new('ShaderNodeMapRange')
    tint.inputs['To Min'].default_value = .75
    tint.inputs['To Max'].default_value = 1.16
    links.new(broad.outputs['Fac'], tint.inputs['Value'])
    mult = nodes.new('ShaderNodeMixRGB')
    mult.blend_type = 'MULTIPLY'
    mult.inputs[0].default_value = 1
    links.new(old_color, mult.inputs[1])
    links.new(tint.outputs['Result'], mult.inputs[2])
    links.new(mult.outputs[0], bs.inputs['Base Color'])
    bump = next(node for node in nodes if node.type == 'BUMP')
    bump.inputs['Distance'].default_value = .00020
    bump.inputs['Strength'].default_value = .60
    return mat
