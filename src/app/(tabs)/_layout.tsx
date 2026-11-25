/**
 * Home, Chat, Arcade and Settings live in a tab group with a custom bottom bar: two tabs each
 * side of a raised microphone in the middle that works from anywhere (see BottomBar).
 * Screens inside an app are pushed on the root stack above this group, so the bar never covers an
 * app's own controls.
 */
import { Tabs } from 'expo-router';

import { BottomBar } from '../../ui/BottomBar';

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <BottomBar {...props} />}>
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="chat" options={{ title: 'Chat' }} />
      <Tabs.Screen name="arcade" options={{ title: 'Arcade' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  );
}
