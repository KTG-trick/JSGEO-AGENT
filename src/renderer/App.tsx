/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Layout } from './components/layout/Layout';
import { TitleBar } from './components/layout/TitleBar';
import { Dashboard } from './views/Dashboard';
import { AgentStudio } from './views/AgentStudio';
import { KnowledgeBase } from './views/KnowledgeBase';
import { Drafts } from './views/Drafts';
import { Projects } from './views/Projects';
import { AutoLearning } from './views/AutoLearning';
import { WebBuilder } from './views/WebBuilder';
import { ViewState } from './types';
import { EnterpriseProvider } from './context/EnterpriseContext';
import { motion } from 'motion/react';

export default function App() {
  const [currentView, setCurrentView] = useState<ViewState>('dashboard');

  useEffect(() => {
    const handleOpenView = (event: Event) => {
      const view = (event as CustomEvent<{ view?: ViewState }>).detail?.view;
      if (view) {
        setCurrentView(view);
      }
    };
    window.addEventListener('geo-agent-open-view', handleOpenView);
    return () => window.removeEventListener('geo-agent-open-view', handleOpenView);
  }, []);

  const views = useMemo(() => [
    ['dashboard', <Dashboard key="dashboard" />],
    ['agent', <AgentStudio key="agent" />],
    ['knowledge', <KnowledgeBase key="knowledge" />],
    ['drafts', <Drafts key="drafts" />],
    ['projects', <Projects key="projects" />],
    ['learning', <AutoLearning key="learning" />],
    ['marketplace', <WebBuilder key="marketplace" />],
  ] as const, []);

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden">
      <TitleBar />
      <EnterpriseProvider>
        <Layout currentView={currentView} onViewChange={setCurrentView}>
          {views.map(([view, element]) => (
            <motion.div
              animate={{ opacity: currentView === view ? 1 : 0, y: currentView === view ? 0 : 12 }}
              className={currentView === view ? 'h-full w-full' : 'hidden'}
              initial={false}
              key={view}
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >
              {element}
            </motion.div>
          ))}
        </Layout>
      </EnterpriseProvider>
    </div>
  );
}

