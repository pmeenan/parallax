"""Native Blender byte-image pixel encoding check; writes fixture into temp only."""
import bpy,struct,zlib,tempfile,json
from pathlib import Path
p=Path(tempfile.gettempdir())/'parallax-known-srgb.png'
def chunk(t,b):return struct.pack('!I',len(b))+t+b+struct.pack('!I',zlib.crc32(t+b))
p.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!2I5B',1,1,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(bytes([0,128,128,128])))+chunk(b'IEND',b''))
im=bpy.data.images.load(str(p))
values=list(im.pixels)
result={'tool':bpy.app.version_string,'fixtureRGBBytes':[128,128,128],'space':im.colorspace_settings.name,'isFloat':im.is_float,'pixels':values,'encoded':128/255,'decoded':((128/255+.055)/1.055)**2.4}
assert abs(values[0]-128/255)<1e-6
(Path(__file__).parent/'color-verification.json').write_text(json.dumps(result,indent=2)+'\n')
