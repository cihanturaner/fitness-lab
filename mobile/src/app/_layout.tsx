import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { openDeviceDatabase } from '@/data/db/open-database';
import { StartupError } from '@/features/shell/startup-error';
import { DataProvider } from '@/store/data-store';
import { color } from '@/theme/tokens';
import { font, fontAssets } from '@/theme/typography';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  const ready = fontsLoaded || fontError !== null;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <DataProvider open={openDeviceDatabase} renderError={(error) => <StartupError error={error} />}>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: color.paper },
          headerStyle: { backgroundColor: color.paper },
          headerShadowVisible: false,
          headerTintColor: color.emerald700,
          headerTitleStyle: { fontFamily: font.bold, color: color.ink },
        }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ title: 'Settings', headerBackTitle: 'Home' }} />
        <Stack.Screen
          name="plan/[date]"
          options={{ title: 'Workout plan', headerBackTitle: 'Training' }}
        />
        <Stack.Screen name="workout/[date]" options={{ title: 'Workout', headerBackTitle: 'Back' }} />
        <Stack.Screen name="bodyweight" options={{ title: 'Bodyweight', headerBackTitle: 'Back' }} />
        <Stack.Screen
          name="quick-add"
          options={{
            presentation: 'formSheet',
            headerShown: false,
            sheetAllowedDetents: 'fitToContents',
            sheetGrabberVisible: true,
            sheetCornerRadius: 28,
            contentStyle: { backgroundColor: color.card },
          }}
        />
      </Stack>
    </DataProvider>
  );
}
