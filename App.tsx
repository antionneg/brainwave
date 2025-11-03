import React, { useState, useCallback, useEffect, useRef } from 'react';
import { generatePlannerSchedule, parsePlannerContent } from './services/geminiService';
import PlannerDisplay from './components/PlannerDisplay';
import type { ScheduleBlock, Task } from './types';
import { MicrophoneIcon, SpeakerWaveIcon, SpeakerXMarkIcon } from './components/icons';

// Add correct typings for SpeechRecognition API to resolve type errors.
interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  onstart: () => void;
  onend: () => void;
  onerror: (event: SpeechRecognitionErrorEvent) => void;
  onresult: (event: SpeechRecognitionEvent) => void;
  start: () => void;
  stop: () => void;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  [index: number]: SpeechRecognitionResult;
  length: number;
}

interface SpeechRecognitionResult {
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
}

interface SpeechRecognitionAlternative {
  transcript: string;
}

// Define the type for the SpeechRecognition API for cross-browser compatibility
// Correctly type the SpeechRecognition constructors on the window object.
declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
    webkitAudioContext: typeof AudioContext;
  }
}

// Check for SpeechRecognition API support
const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
const isSpeechRecognitionSupported = !!SpeechRecognitionAPI;

const MUTE_STORAGE_KEY = 'brainwave-muted';
const SCHEDULE_STORAGE_KEY = 'brainwave-planner-schedule';
const COMPLETED_TASKS_STORAGE_KEY = 'brainwave-completed-tasks';


const App: React.FC = () => {
  const [schedule, setSchedule] = useState<ScheduleBlock[] | null>(() => {
    try {
        const savedSchedule = localStorage.getItem(SCHEDULE_STORAGE_KEY);
        if (savedSchedule) {
            return JSON.parse(savedSchedule);
        }
        return null;
    } catch (error) {
        console.error("Failed to load schedule from localStorage", error);
        localStorage.removeItem(SCHEDULE_STORAGE_KEY); // Clear corrupted data
        return null;
    }
  });
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  
  // State for personalization
  const [userPrompt, setUserPrompt] = useState<string>("I have 2 kids, work from home for about 4-5 hours, and my top priority today is finishing a work report.");

  // State for reminders
  const [reminderTime, setReminderTime] = useState<number>(5); // Default 5 minutes
  const [notificationPermission, setNotificationPermission] = useState('default');
  
  // State for Voice AI
  const [isListening, setIsListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  
  // Audio state
  const [isMuted, setIsMuted] = useState<boolean>(() => {
    try {
        const storedMute = localStorage.getItem(MUTE_STORAGE_KEY);
        return storedMute ? JSON.parse(storedMute) : false;
    } catch {
        return false;
    }
  });
  const audioContextRef = useRef<AudioContext | null>(null);

  // State for completed tasks (centralized here)
  const [completedTasks, setCompletedTasks] = useState<Record<string, boolean>>({});

  // Load completed tasks from localStorage on initial mount
  useEffect(() => {
    try {
      const storedTasks = localStorage.getItem(COMPLETED_TASKS_STORAGE_KEY);
      if (storedTasks) {
        setCompletedTasks(JSON.parse(storedTasks));
      }
    } catch (error) {
      console.error("Failed to load completed tasks from localStorage", error);
    }
  }, []);

  // Save completed tasks to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(COMPLETED_TASKS_STORAGE_KEY, JSON.stringify(completedTasks));
    } catch (error) {
      console.error("Failed to save completed tasks to localStorage", error);
    }
  }, [completedTasks]);

  // Effect to save mute state
  useEffect(() => {
    try {
        localStorage.setItem(MUTE_STORAGE_KEY, JSON.stringify(isMuted));
    } catch (error) {
        console.error("Failed to save mute state to localStorage", error);
    }
  }, [isMuted]);

  // Effect to save schedule state
  useEffect(() => {
    try {
        if (schedule) {
            localStorage.setItem(SCHEDULE_STORAGE_KEY, JSON.stringify(schedule));
        } else {
            localStorage.removeItem(SCHEDULE_STORAGE_KEY);
        }
    } catch (error) {
        console.error("Failed to save schedule to localStorage", error);
    }
  }, [schedule]);

  const playSound = useCallback((type: OscillatorType, frequency: number, duration: number) => {
    if (isMuted) return;

    if (!audioContextRef.current) {
        try {
            audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            console.error("Web Audio API is not supported in this browser.");
            return;
        }
    }
    const context = audioContextRef.current;
    if (!context) return;
    
    if (context.state === 'suspended') {
        context.resume();
    }

    const oscillator = context.createOscillator();
    const gainNode = context.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, context.currentTime);
    
    gainNode.gain.setValueAtTime(0.1, context.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);

    oscillator.connect(gainNode);
    gainNode.connect(context.destination);

    oscillator.start();
    oscillator.stop(context.currentTime + duration);
  }, [isMuted]);

  const speak = useCallback((text: string) => {
    if (isMuted || !window.speechSynthesis) return;

    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;
    utterance.pitch = 1.1;
    
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      const femaleVoice = voices.find(voice => voice.lang.startsWith('en') && voice.name.includes('Female'));
      if (femaleVoice) {
          utterance.voice = femaleVoice;
      }
    }
    
    window.speechSynthesis.speak(utterance);
  }, [isMuted]);

  useEffect(() => {
    setNotificationPermission(Notification.permission);

    // Ensure voices are loaded for the speak function
    if (window.speechSynthesis && window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    }

    if (!isSpeechRecognitionSupported) {
        setVoiceError("Voice recognition is not supported by your browser.");
        return;
    }

    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => {
        setIsListening(true);
        setVoiceError(null);
    };

    recognition.onend = () => {
        setIsListening(false);
    };

    recognition.onerror = (event) => {
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
              setVoiceError("Microphone access denied. Please enable it in your browser settings.");
        } else {
            setVoiceError(`Voice recognition error: ${event.error}`);
        }
        setIsListening(false);
    };

    recognition.onresult = (event) => {
        const transcript = Array.from(event.results)
            .map(result => result[0])
            .map(result => result.transcript)
            .join('');
        setUserPrompt(transcript);
    };

    recognitionRef.current = recognition;
  }, []);

  const handleReminderChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const minutes = parseInt(e.target.value, 10);
    setReminderTime(minutes);
    if (minutes > 0 && Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
    }
  };

  const handleToggleListening = () => {
      if (!recognitionRef.current) return;

      if (isListening) {
          recognitionRef.current.stop();
      } else {
          navigator.mediaDevices.getUserMedia({ audio: true })
              .then(() => {
                  recognitionRef.current?.start();
              })
              .catch(() => {
                  setVoiceError("Microphone access denied. Please enable it in your browser settings.");
              });
      }
  };

  const handleGenerate = useCallback(async () => {
    playSound('sine', 200, 0.15); // Click sound
    setIsLoading(true);
    setError(null);
    setSchedule(null);
    setCompletedTasks({}); // Clear completed tasks for new schedule
    localStorage.removeItem(COMPLETED_TASKS_STORAGE_KEY);
    
    try {
      const generatedContent = await generatePlannerSchedule(userPrompt);
      const parsedSchedule = parsePlannerContent(generatedContent);
      setSchedule(parsedSchedule);
      speak("Your personalized plan is ready. Let's have a productive day!");
    } catch (e: unknown) {
      if (e instanceof Error) {
        setError(e.message);
      } else {
        setError("An unknown error occurred.");
      }
    } finally {
      setIsLoading(false);
    }
  }, [userPrompt, speak, playSound]);
  
  const handleUpdateTaskText = (blockId: number, taskIndex: number, newText: string) => {
    setSchedule(currentSchedule => {
      if (!currentSchedule) return null;
      
      const newSchedule = JSON.parse(JSON.stringify(currentSchedule));
      const blockToUpdate = newSchedule.find((block: ScheduleBlock) => block.id === blockId);

      if (blockToUpdate && blockToUpdate.tasks[taskIndex]) {
        blockToUpdate.tasks[taskIndex].text = newText;
      }
      
      return newSchedule;
    });
  };

  const handleUpdateTaskNotes = (blockId: number, taskIndex: number, newNotes: string) => {
    setSchedule(currentSchedule => {
      if (!currentSchedule) return null;
      
      const newSchedule = JSON.parse(JSON.stringify(currentSchedule));
      const blockToUpdate = newSchedule.find((block: ScheduleBlock) => block.id === blockId);
  
      if (blockToUpdate && blockToUpdate.tasks[taskIndex]) {
        blockToUpdate.tasks[taskIndex].notes = newNotes;
      }
      
      return newSchedule;
    });
  };

  const handleDeleteTask = (blockId: number, taskIndex: number) => {
    setSchedule(currentSchedule => {
      if (!currentSchedule) return null;
      
      return currentSchedule.map(block => {
        if (block.id === blockId) {
          const newTasks = block.tasks.filter((_, index) => index !== taskIndex);
          return { ...block, tasks: newTasks };
        }
        return block;
      });
    });
  };

  const handleReorderTasks = (
    source: { blockId: number; taskIndex: number },
    destination: { blockId: number; taskIndex: number }
  ) => {
    setSchedule(currentSchedule => {
      if (!currentSchedule) return null;

      const newSchedule = JSON.parse(JSON.stringify(currentSchedule)); // Deep copy

      const sourceBlock = newSchedule.find((b: ScheduleBlock) => b.id === source.blockId);
      const destinationBlock = newSchedule.find((b: ScheduleBlock) => b.id === destination.blockId);

      if (!sourceBlock || !destinationBlock) {
        return currentSchedule;
      }

      const [removedTask] = sourceBlock.tasks.splice(source.taskIndex, 1);
      destinationBlock.tasks.splice(destination.taskIndex, 0, removedTask);

      return newSchedule;
    });
  };
  
  const handleNotify = useCallback(() => {
    playSound('square', 800, 0.25);
  }, [playSound]);

  const handleToggleTask = useCallback((blockId: number, taskIndex: number) => {
    const taskId = `${blockId}-${taskIndex}`;
    const isNowCompleted = !completedTasks[taskId];
    if (isNowCompleted) {
      playSound('triangle', 1200, 0.2);
    }
    setCompletedTasks(prev => ({
      ...prev,
      [taskId]: isNowCompleted,
    }));
  }, [playSound, completedTasks]);
  
  const handleClearCompletedTasks = () => {
    playSound('sine', 150, 0.2); // Add a sound effect for this action
    setSchedule(currentSchedule => {
        if (!currentSchedule) return null;

        // Create a new schedule where completed tasks are filtered out from each block
        const newSchedule = currentSchedule.map(block => {
            const newTasks = block.tasks.filter((_, taskIndex) => {
                const taskId = `${block.id}-${taskIndex}`;
                return !completedTasks[taskId];
            });
            return { ...block, tasks: newTasks };
        });

        return newSchedule;
    });

    // Reset the completed tasks state
    setCompletedTasks({});
  };

  const Header = () => (
    <header className="relative text-center mb-8 animate-fade-in-up" style={{ animationDelay: '100ms' }}>
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500 mb-2 text-glow">
          Brain Wave
        </h1>
        <p className="text-base md:text-lg text-slate-300">
          Your AI-powered daily planner for a calmer, more organized life.
        </p>
        <button
            onClick={() => setIsMuted(prev => !prev)}
            className="absolute top-0 right-0 p-2 text-slate-400 hover:text-white transition-colors rounded-full hover:bg-slate-700/50"
            title={isMuted ? "Unmute Voice" : "Mute Voice"}
        >
            {isMuted ? <SpeakerXMarkIcon /> : <SpeakerWaveIcon />}
        </button>
    </header>
  );

  const PlannerForm = () => (
    <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-xl shadow-lg p-4 sm:p-6 mb-8 space-y-4 animate-fade-in-up" style={{ animationDelay: '200ms' }}>
      <h2 className="text-xl font-bold text-slate-100 border-b border-slate-600 pb-2">Describe Your Day</h2>
      <div>
        <label htmlFor="userPrompt" className="block text-sm font-medium text-slate-300 mb-2">
          Tell the AI what your day looks like. Mention kids, work, and your top priority.
        </label>
        <div className="relative">
          <textarea 
            id="userPrompt"
            value={userPrompt}
            onChange={(e) => setUserPrompt(e.target.value)}
            className="w-full bg-slate-700 border border-slate-600 rounded-md px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500 pr-12"
            placeholder="e.g., I have 2 kids, work from home for about 4-5 hours, and my top priority today is finishing a work report."
            rows={3}
          />
          <button
            onClick={handleToggleListening}
            disabled={!isSpeechRecognitionSupported}
            className={`absolute top-1/2 right-3 -translate-y-1/2 p-1.5 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-700 focus:ring-cyan-500 ${isListening ? 'bg-cyan-500/20 text-cyan-400 animate-pulse' : 'text-slate-400 hover:bg-slate-600'} disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent`}
            aria-label={isListening ? 'Stop listening' : 'Start voice input'}
            title={isListening ? 'Stop listening' : 'Start voice input'}
          >
            <MicrophoneIcon />
          </button>
        </div>
        {voiceError && (
          <p className="text-xs text-red-400 mt-1">{voiceError}</p>
        )}
      </div>
       <div>
          <label htmlFor="reminderTime" className="block text-sm font-medium text-slate-300 mb-1">Reminders</label>
          <select
            id="reminderTime"
            value={reminderTime}
            onChange={handleReminderChange}
            className="w-full bg-slate-700 border border-slate-600 rounded-md px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
          >
            <option value="0">Off</option>
            <option value="1">1 minute before</option>
            <option value="5">5 minutes before</option>
            <option value="10">10 minutes before</option>
            <option value="15">15 minutes before</option>
          </select>
          {notificationPermission === 'denied' && (
            <p className="text-xs text-red-400 mt-1">Notifications are blocked. Please enable them in your browser settings.</p>
          )}
        </div>
    </div>
  );

  const GenerateButton = () => (
    <button
      onClick={handleGenerate}
      disabled={isLoading}
      className="w-full sm:w-auto flex items-center justify-center px-6 py-3 sm:px-8 sm:py-4 bg-cyan-500 text-white font-bold text-base sm:text-lg rounded-lg shadow-lg hover:bg-cyan-600 disabled:bg-slate-500 disabled:cursor-not-allowed transition-all duration-300 transform hover:scale-105 focus:outline-none focus:ring-4 focus:ring-cyan-500/50 button-glow"
    >
      {isLoading ? (
        <>
          <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          Generating Your Plan...
        </>
      ) : (
        'Generate My Personalized Plan'
      )}
    </button>
  );

  return (
    <div className="min-h-screen bg-transparent text-white">
      <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12 max-w-4xl">
        <Header />
        
        <PlannerForm />

        <div className="flex justify-center mb-10 animate-fade-in-up" style={{ animationDelay: '300ms' }}>
           <GenerateButton />
        </div>

        <div className="transition-opacity duration-500">
          {isLoading && (
            <div className="text-center text-slate-400 animate-fade-in-up">
                <p>Please wait, our AI assistant is crafting the perfect schedule for you...</p>
            </div>
          )}

          {error && (
            <div className="bg-red-500/20 border border-red-500 text-red-300 px-4 py-3 rounded-lg text-center animate-fade-in-up" role="alert">
              <strong className="font-bold">Oops! </strong>
              <span className="block sm:inline">{error}</span>
            </div>
          )}

          {schedule && !isLoading && (
            <PlannerDisplay 
              blocks={schedule} 
              reminderTime={reminderTime} 
              completedTasks={completedTasks}
              onUpdateTaskText={handleUpdateTaskText} 
              onUpdateTaskNotes={handleUpdateTaskNotes}
              onDeleteTask={handleDeleteTask} 
              onReorderTasks={handleReorderTasks}
              onNotify={handleNotify}
              onToggleTask={handleToggleTask}
              onClearCompletedTasks={handleClearCompletedTasks}
            />
          )}
        </div>

      </main>
    </div>
  );
};

export default App;
