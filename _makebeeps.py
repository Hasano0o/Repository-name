# يولّد نغمات وضع الصوت (بدون مكتبات)
import wave, struct, math, os
os.makedirs('assets/sounds', exist_ok=True)
def beep(path, freq, ms=70, rate=22050, vol=0.6):
    n = int(rate*ms/1000); fade = int(rate*0.008)
    with wave.open(path,'w') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
        fr = bytearray()
        for i in range(n):
            env = min(1, i/fade, (n-1-i)/fade)
            fr += struct.pack('<h', int(vol*env*math.sin(2*math.pi*freq*i/rate)*32767))
        w.writeframes(bytes(fr))
beep('assets/sounds/beep-low.wav', 440)
beep('assets/sounds/beep-mid.wav', 740)
beep('assets/sounds/beep-high.wav', 1175)
print('OK sounds')
