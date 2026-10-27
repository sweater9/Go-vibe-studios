import numpy as np, wave, sys
from math import pi
sr=44100
def track(bpm, bars, prog, name, seed=1, key=57):
    rng=np.random.default_rng(seed); spb=60/bpm; n=int(sr*spb*4*bars); L=np.zeros(n); R=np.zeros(n)
    def add(x,t,pan=0.5,g=1.0):
        i=int(t*sr); e=min(n,i+len(x))
        if i>=n: return
        L[i:e]+=x[:e-i]*g*(1-pan)*1.4; R[i:e]+=x[:e-i]*g*pan*1.4
    tt=np.arange(int(sr*0.5))/sr
    kick=np.sin(2*pi*(45*tt+ 90*(1-np.exp(-tt*30))/30 ))*np.exp(-tt*9)
    sn=(rng.standard_normal(len(tt))*np.exp(-tt*22)*0.6+np.sin(2*pi*190*tt)*np.exp(-tt*25)*0.5)
    hat=rng.standard_normal(int(sr*0.08)); hat=np.diff(hat,prepend=0)*np.exp(-np.arange(len(hat))/sr*70)*0.5
    def saw(f,d,att=0.01,rel=0.1,harm=12):
        t=np.arange(int(sr*d))/sr; x=sum(np.sin(2*pi*f*k*t)/k for k in range(1,harm+1))
        env=np.minimum(1,t/att)*np.minimum(1,(d-t)/rel).clip(0); return x*env
    for bar in range(bars):
        t0=bar*spb*4; chord=prog[bar%len(prog)]
        for beat in range(4):
            tb=t0+beat*spb
            add(kick,tb,0.5,0.9)
            if beat in (1,3): add(sn,tb,0.5,0.6)
            for h in (0,0.5): add(hat,tb+h*spb,0.6 if h else 0.4,0.5)
        root=key+chord[0]-24
        for k in range(8):
            f=440*2**((root-69)/12); add(saw(f,spb*0.45,0.005,0.05,6)*0.5,t0+k*spb/2,0.5,0.55)
        if bar>=2:
            for iv in chord: 
                f=440*2**((key+iv-69)/12); add(saw(f,spb*1.8,0.05,0.4,8)*0.18,t0,0.35+0.3*np.random.default_rng(abs(iv)+1).random(),0.8)
                add(saw(f,spb*1.8,0.05,0.4,8)*0.18,t0+2*spb,0.55,0.8)
        if bar>=4:
            for k in range(8):
                iv=chord[k%3]+12; f=440*2**((key+iv-69)/12); add(saw(f,spb*0.4,0.003,0.1,5)*0.22,t0+k*spb/2,0.3+0.4*(k%2),0.6)
    m=max(abs(L).max(),abs(R).max()); L/=m; R/=m; L*=0.85; R*=0.85
    st=np.stack([L,R],1); data=(st*32767).astype('<i2')
    with wave.open(name,'wb') as w: w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr); w.writeframes(data.tobytes())
am=[(0,3,7),(-4,0,3),(3,7,10),(-2,2,5)]  # Am F C G relative-ish
track(124,16,am,'night-drive.wav',1)
track(126,16,[(0,4,7),(5,9,12),(7,11,14),(5,9,12)],'sunrise.wav',2,key=60)
