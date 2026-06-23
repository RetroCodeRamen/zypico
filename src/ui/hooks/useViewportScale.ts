import { useLayoutEffect, useRef, useState } from "react";

// Scale-to-fit: the gadget is laid out at its true design size, then scaled by
// one uniform factor to fit the viewport — preserving the aspect ratio exactly
// (no stretching), fitting both phone and desktop. Returns the two refs to
// attach (outer stage + inner device) and the computed scale.
export function useViewportScale() {
  const stageRef = useRef<HTMLDivElement>(null);
  const deviceRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const fit = () => {
      const stage = stageRef.current;
      const device = deviceRef.current;
      if (!stage || !device) return;
      // offsetWidth/Height report the pre-transform layout size, so measuring
      // while scaled is safe and doesn't feed back.
      const natW = device.offsetWidth;
      const natH = device.offsetHeight;
      if (natW === 0 || natH === 0) return;
      const s = Math.min(stage.clientWidth / natW, stage.clientHeight / natH);
      setScale(s);
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (stageRef.current) ro.observe(stageRef.current);
    if (deviceRef.current) ro.observe(deviceRef.current);
    window.addEventListener("resize", fit);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, []);

  return { stageRef, deviceRef, scale };
}
