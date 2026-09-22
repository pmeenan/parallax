"""One technical bake control: bind object coordinates explicitly to source."""
from pathlib import Path
root = Path(__file__).parent
code = (root/'transfer-resolved.py').read_text()
code = code.replace("/'transfer';OUT.mkdir", "/'transfer-explicit-object';OUT.mkdir")
anchor = "stone=source_scene.objects['Broad source '+label]"
assert anchor in code
code = code.replace(anchor, anchor + "\n    for node in stone.data.materials[0].node_tree.nodes:\n        if node.type=='TEX_COORD':node.object=stone")
exec(compile(code, str(Path(__file__)), 'exec'), {'__file__': __file__})
views = (root/'transfer-views.py').read_text()
views = views.replace("folder = root/'transfer/a'", "folder = root/'transfer-explicit-object/a'")
exec(compile(views, str(Path(__file__)), 'exec'), {'__file__': __file__})
