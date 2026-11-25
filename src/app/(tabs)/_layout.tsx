/**
 * Home and Settings live in a tab group with a custom bottom bar: Home on the left, Settings on
 * the right, and a raised microphone in the middle that works from anywhere (see BottomBar).
 * Screens inside an app are pushed on the root stack above this group, so the bar never covers an
 * app's own controls.
 */
import { Tabs } from 'expo-router';

import { BottomBar } from '../../ui/BottomBar';

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <BottomBar {...props} />}>
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  );
}
