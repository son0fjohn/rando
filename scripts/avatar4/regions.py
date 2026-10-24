# the base body's region mask: R skin, G tee, B shorts (the painted eyes count as skin: the face is its own layer)
import json, numpy as np
from PIL import Image, ImageDraw, ImageFilter
N=512
g=json.load(open("geom.json")); P=np.array(g["pos"]).reshape(-1,3); UV=np.array(g["uv"]).reshape(-1,2); I=np.array(g["idx"]).reshape(-1,3)
tex=np.asarray(Image.open("tex1024.png").convert("RGB").resize((N,N),Image.LANCZOS)).astype(np.float32)
C=P[I].mean(1)
face=(C[:,1]>0.77)&(C[:,2]>0.0)&(np.abs(C[:,0])<0.1)
lab=np.zeros((N,N),np.uint8)   # 1 skin-forced, 2 upper (tee) area, 3 lower (shorts) area
img=Image.new("L",(N,N),0); d=ImageDraw.Draw(img)
for k,t in enumerate(I):
  c=C[k]; v=1 if face[k] or c[1]>0.76 or c[1]<0.335 else (2 if c[1]>0.505 else 3)
  d.polygon([(UV[i,0]*N, UV[i,1]*N) for i in t], fill=v)
lab=np.asarray(img.filter(ImageFilter.MaxFilter(3)))
r,gg,b=tex[...,0],tex[...,1],tex[...,2]
sat=(r-b)
gray=sat<22
skin=(~gray)|(lab==1)
out=np.zeros((N,N,3),np.uint8)
out[...,0]=np.where(skin,255,0)
out[...,1]=np.where((~skin)&(lab==2),255,0)
out[...,2]=np.where((~skin)&(lab==3),255,0)
# fill unused texels from neighbours (no black seams under mipmapping)
im=Image.fromarray(out)
for _ in range(4):
  m=np.asarray(im); empty=(m.sum(2)==0)
  grown=np.asarray(im.filter(ImageFilter.MaxFilter(3)))
  m=np.where(empty[...,None],grown,m); im=Image.fromarray(m.astype(np.uint8))
im=im.filter(ImageFilter.GaussianBlur(0.6))
im.save("regions.png", optimize=True)
print("skin", skin.mean(), "tee", ((~skin)&(lab==2)).mean(), "shorts", ((~skin)&(lab==3)).mean())
