'use client';

import { Celebrations, HolidaysPanel, TeamAvailability, useHolidays } from '@/components/home/PeoplePanels';
import { Spotlight } from '@/components/home/Spotlight';
import { Last7DaysCard, NeedsHumanCard, OnCallCard, SlaHealthCard } from '@/components/home/TopCards';
import { ToolStatusPanel } from '@/components/home/ToolStatusPanel';
import { CURRENT_AGENT } from '@/data/seed';
import { useNow } from '@/hooks/useNow';
import { usePlatformStore } from '@/store/usePlatformStore';

/** Home: four at-a-glance cards, then the informational (and fun) stuff about tools and people. */
export function HomeView() {
  const now = useNow();
  const users = usePlatformStore((s) => s.users);
  const holidays = useHolidays(users.filter((u) => u.active).map((u) => u.country));
  const hour = new Date(now).getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const date = new Date(now).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-5 md:p-6">
      <header>
        <p className="text-xs text-slate-500">{date}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{greeting}, {CURRENT_AGENT.split(' ')[0]} 👋</h1>
      </header>

      <section aria-label="At a glance" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Last7DaysCard />
        <OnCallCard />
        <NeedsHumanCard />
        <SlaHealthCard />
      </section>

      {/* Two independent columns so tall panels never leave gaps beside short ones. */}
      <div className="grid items-start gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <ToolStatusPanel />
          <TeamAvailability holidays={holidays.holidays} />
        </div>
        <div className="space-y-5">
          <Celebrations />
          <HolidaysPanel {...holidays} />
        </div>
      </div>

      <Spotlight />
    </div>
  );
}
