import { TabList, Tabs, TabSlot, TabTrigger } from 'expo-router/ui';
import { StyleSheet } from 'react-native';

import { BarLayout, TabButton, TABS } from '@/features/shell/tab-bar';

export default function TabsLayout() {
  return (
    <Tabs style={styles.fill}>
      <TabSlot style={styles.fill} />
      <TabList asChild>
        <BarLayout>
          {TABS.map((tab) => (
            <TabTrigger key={tab.name} name={tab.name} href={tab.href} asChild>
              <TabButton icon={tab.icon} label={tab.label} />
            </TabTrigger>
          ))}
        </BarLayout>
      </TabList>
    </Tabs>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
