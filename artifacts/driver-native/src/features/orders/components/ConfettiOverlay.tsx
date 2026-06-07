import { useEffect, useRef } from "react";
import { Animated, Dimensions, Easing, View } from "react-native";

const COLORS = ["#F59E0B", "#FBBF24", "#FCD34D", "#10B981", "#34D399", "#6EE7B7", "#F97316", "#FB923C", "#EF4444", "#A855F7", "#818CF8", "#FFFFFF"];

// RN port of web ConfettiOverlay (CSS keyframes -> Animated). Falling particles.
export function ConfettiOverlay() {
  const { width, height } = Dimensions.get("window");
  const particles = useRef(
    Array.from({ length: 50 }, (_, i) => ({
      id: i,
      x: Math.random() * width,
      delay: Math.random() * 1000,
      dur: 1500 + Math.random() * 1500,
      size: 6 + Math.random() * 10,
      color: COLORS[i % COLORS.length],
      drift: (Math.random() - 0.5) * 140,
      rotate: Math.random() * 720 + 360,
      shape: i % 3,
      v: new Animated.Value(0),
    })),
  ).current;

  useEffect(() => {
    const anims = particles.map((p) =>
      Animated.timing(p.v, {
        toValue: 1,
        duration: p.dur,
        delay: p.delay,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    );
    Animated.parallel(anims).start();
  }, [particles]);

  return (
    <View pointerEvents="none" style={{ position: "absolute", inset: 0, overflow: "hidden", zIndex: 40 }}>
      {particles.map((p) => {
        const translateY = p.v.interpolate({ inputRange: [0, 1], outputRange: [-20, height + 20] });
        const translateX = p.v.interpolate({ inputRange: [0, 1], outputRange: [0, p.drift] });
        const rotate = p.v.interpolate({ inputRange: [0, 1], outputRange: ["0deg", `${p.rotate}deg`] });
        const opacity = p.v.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] });
        return (
          <Animated.View
            key={p.id}
            style={{
              position: "absolute",
              left: p.x,
              top: 0,
              width: p.shape === 2 ? p.size * 1.5 : p.size,
              height: p.shape === 1 ? p.size * 0.5 : p.size,
              backgroundColor: p.color,
              borderRadius: p.shape === 0 ? p.size : 2,
              transform: [{ translateY }, { translateX }, { rotate }],
              opacity,
            }}
          />
        );
      })}
    </View>
  );
}
