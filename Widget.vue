Widgetcard.vue - is long - let's try to share it:

<template>
  <div v-if="isVisible" :style="getWidgetContainerStyles()">
    <CloseBtn
      @click="goToFirstStep"
      v-if="
        widgetStore.isQuestionVisible ||
        recordingComplete ||
        widgetStore.showAssessmentResults ||
        widgetStore.showEmailForm
      "
    >
      <img :src="closeIcon" alt="close icon" />
    </CloseBtn>
    <WidgetCard>
      <!-- Logo section with loading state -->
     <div v-if="config?.secretKey !== 'Oei0C1asH1RIlDo3wojz3KkdehM4zrUR'">
      <div style="height: 32px; width: 200px !important; margin-top: 10px; margin-bottom: 20px; display: flex; align-items: center; justify-content: center;">
        <Loader v-if="isLogoLoading" customClass="logo-loader" />
        <img v-else :src="logo" alt="Logo" style="height: 32px; width: 200px !important;" />
      </div>
      </div>
      <div v-else>
        <div style="height: 45px; width: 225px !important; margin-top: 10px; margin-bottom: 20px; display: flex; align-items: center; justify-content: center;">
          <Loader v-if="isLogoLoading" customClass="logo-loader" />
          <img v-else :src="logo" alt="Logo" style="height: 45px; width: 225px !important;" />
        </div>
      </div>
      <!-- Show loading state -->
      <template v-if="widgetStore.isAnalyzing">
        <LoadingState>
          <Loader :is-custom="false" />
          <p>Analyzing your response...</p>
          <p>This may take a few moments</p>
        </LoadingState>
      </template>

      <!-- Show results state -->
      <template v-else-if="widgetStore.showAssessmentResults">
        <ResultsState>
          <TOEFLSpeakingAssessment
            :progressItems="skills"
            :cefr="widgetStore?.elsaResults.elsa_results.cefr_level"
            :toeflScore="widgetStore?.elsaResults.elsa_results.toefl_score"
            :ieltsScore="widgetStore?.elsaResults.elsa_results.ielts_score"
            :pte="widgetStore?.elsaResults.elsa_results.pte_score"
          />
        </ResultsState>
      </template>

      <template v-else-if="widgetStore.showThankYou">
        <ThankYouState>
          <ThankYouIcon>
            <svg
              width="64"
              height="64"
              viewBox="0 0 64 64"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle cx="32" cy="32" r="32" fill="#22C55E" />
              <path
                d="M44.0001 24L28.0001 40L20 32"
                stroke="white"
                stroke-width="4"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </ThankYouIcon>
          <h2>Thank You!</h2>
          <p>{{ (config?.secretKey === 'Oei0C1asH1RIlDo3wojz3KkdehM4zrUR') ? 'Thank you! You\'re on my list 😊' : 'Thank you! You\'re on our list 😊' }}</p>
        </ThankYouState>
        <ButtonWrapper v-if="hasSecretKey">
            <SignupLinkButton 
              :href="apiResponseData?.signup_url" 
              target="_blank" 
              rel="noopener noreferrer"
              style="background-color: #1cab83;"
            >
              {{ (config?.secretKey === 'Oei0C1asH1RIlDo3wojz3KkdehM4zrUR') ? 'Visit Jennifer\'s Patreon Page' : 'Sign up with ' + apiResponseData?.name }}
              <!-- Sign up with {{ apiResponseData?.name }} -->
            </SignupLinkButton>
              <SignupLinkButton
                v-if="config?.secretKey !== 'Oei0C1asH1RIlDo3wojz3KkdehM4zrUR'"
                href="https://app.myspeakingscore.com/login" 
                target="_blank" 
                rel="noopener noreferrer"
              >
                Sign up with MySpeakingScore
              </SignupLinkButton>
          </ButtonWrapper>
      </template>

      <template v-else-if="widgetStore.showEmailForm">
        <EmailFormState>
          <EmailFormHeader>
            <h2>{{ config?.secretKey === 'Oei0C1asH1RIlDo3wojz3KkdehM4zrUR' ? 'Join my email list and stay connected!' : 'Sign up to access free TOEFL Speaking training and incentives.' }}</h2>
          </EmailFormHeader>

          <EmailInputContainer>
            <input
              v-model="emailForm.email"
              type="email"
              placeholder="Your email"
              :disabled="isSubmitting"
              :style="emailInputStyles"
            />
            <input
              v-model="emailForm.name"
              type="text"
              class="email-input"
              placeholder="Your name"
              :disabled="isSubmitting"
              :style="emailInputStyles"
            />
            <div v-if="config?.secretKey !== 'Oei0C1asH1RIlDo3wojz3KkdehM4zrUR'">
              <input
                v-model="emailForm.consent"
                type="checkbox"
                id="training-tips"
                :disabled="isSubmitting"
              />
              <LabelInput for="training-tips">Yes, send me training tips too!</LabelInput>
            </div>
          </EmailInputContainer>
        </EmailFormState>
      </template>
      <!-- Show recording complete block if recording is complete -->
      <template v-else-if="recordingComplete">
        <RecordingCompleteBlock>
          <Timer>{{ formattedTime }}</Timer>
          <RecordingCompleteLabel>Recorded</RecordingCompleteLabel>
          <RecordedDuration>{{ recordedDuration }}</RecordedDuration>
          <!-- <SecondRemaining>Seconds remaining</SecondRemaining> -->
          <RecordedAudioPlayer :src="recordedAudioUrl" controls></RecordedAudioPlayer>
        </RecordingCompleteBlock>
      </template>

      <!-- Show initial content if not showing questions and recording not complete -->
      <template v-else-if="!widgetStore.isQuestionVisible">
        <ContentWrapper>
          <!-- Content Section -->
          <div style="text-align: center">
            <StyledHeading>{{ (config?.secretKey === 'Oei0C1asH1RIlDo3wojz3KkdehM4zrUR') ? 'CEFR Level Estimator' : 'TOEFL Speaking Score Estimator' }}</StyledHeading>
            <StyledText>
              <span v-if="config?.secretKey === 'Oei0C1asH1RIlDo3wojz3KkdehM4zrUR'">
                Want to know your CEFR level?<br>
                Record a 45-second answer and get an instant estimate.
              </span>
              <span v-else>
                Want to know your TOEFL Speaking score? Record a 45-second answer and get an instant estimate.
              </span>
            </StyledText>
          </div>
        </ContentWrapper>
      </template>

      <!-- Show question/recording interface if not recording complete -->
      <template v-else>
        <template v-if="questionSelected">
          <SelectedQuestionDisplay :style="[getResponsiveStyles('selectedQuestionDisplay')]">
            <QuestionPara
              v-html="
                widgetStore?.selectedQuestion
                  .replace(/\\n/g, '<br><br>')
                  .replace(/([.!?])\s+/g, '$1<br><br>')
              "
            ></QuestionPara>
            <!-- Your audio recorder component or HTML here -->
            <AudioRecorder
              @recording-started="widgetStore.setRecordingActive(true)"
              @recording-stopped="widgetStore.setRecordingActive(false)"
              @recording-complete="handleRecordingComplete"
            />
            <!-- Cancel button replaces Change Question during recording -->
            <AudioCancelBtn
              v-if="recordingActive"
              @click="cancelRecording"
              :style="[getResponsiveStyles('audioCancelBtn')]"
            >
              Cancel Recording
            </AudioCancelBtn>
          </SelectedQuestionDisplay>
        </template>
        <template v-else>
          <!-- <QuestionSlider
            :questions="questions"
            :current-index="widgetStore.currentQuestionIndex"
            @update:currentIndex="widgetStore.setCurrentQuestionIndex"
            @select-question="handleSelectQuestion"
            @cancel="handleCancel"
          /> -->
          <QuestionWrapper>
            <Question
              v-html="
                widgetStore?.currentGeneratedQuestion
                  .replace(/\\n/g, '<br><br>')
                  .replace(/([.!?])\s+/g, '$1<br><br>')
              "
            ></Question>
          </QuestionWrapper>
        </template>
      </template>

      <!-- Footer Section -->
      <div class="footer-section" :style="[getResponsiveStyles('footerSection')]">
        <div
          class="button-section"
          v-if="!widgetStore.isQuestionVisible && !recordingComplete && !widgetStore.showThankYou"
          :style="[getResponsiveStyles('buttonSection')]"
        >
          <Button
            type="primary"
            @click="showQuestions"
            :disabled="isLoadingQuestion"
            :style="[getResponsiveStyles('actionButton')]"
          >
            <template v-if="isLoadingQuestion">
              <Loader customClass="custom-loader-class" />
            </template>
            <template v-else> Let's Go! </template>
          </Button>
        </div>
        
        <!-- Question buttons in footer -->
        <div
          class="button-section"
          v-if="widgetStore.isQuestionVisible && !questionSelected && !recordingComplete && !widgetStore.showThankYou"
          :style="[getResponsiveStyles('buttonSection')]"
        >
          <ButtonWrapper>
            <AnswerQuestionButton @click="handleSelectQuestion">
              Record a Response
            </AnswerQuestionButton>
            <AudioCancelBtn @click="handleChangeQuestion" :disabled="isChangingQuestion">
              <CancelBtnLoader v-if="isChangingQuestion"></CancelBtnLoader>
              <template v-else>New Question</template>
            </AudioCancelBtn>
          </ButtonWrapper>
        </div>
        
        <!-- New Question button for selected question in footer -->
        <div
          class="button-section"
          v-if="questionSelected && !recordingActive && !recordingComplete && !widgetStore.showThankYou"
          :style="[getResponsiveStyles('buttonSection')]"
        >
          <ChangeQuestionButton
            @click="handleChangeQuestion"
            :disabled="isChangingQuestion"
            :style="[getResponsiveStyles('changeQuestionButton')]"
          >
            <template v-if="isChangingQuestion">
              <Loader customClass="custom-loader-class" />
            </template>
            <template v-else>New Question</template>
          </ChangeQuestionButton>
        </div>
        
        <!-- Recording complete buttons in footer -->
        <div
          class="button-section"
          v-if="recordingComplete && !widgetStore.isAnalyzing && !widgetStore.showAssessmentResults && !widgetStore.showEmailForm && !widgetStore.showThankYou"
          :style="[getResponsiveStyles('buttonSection')]"
        >
          <ButtonWrapper>
            <ChangeQuestionButton @click="handleSubmit">Submit for Scoring</ChangeQuestionButton>
            <AudioCancelBtn @click="retryRecording">Record Again</AudioCancelBtn>
          </ButtonWrapper>
        </div>
        
        <!-- Results screen buttons in footer -->
        <div
          class="button-section"
          v-if="widgetStore.showAssessmentResults && !widgetStore.showThankYou"
          :style="[getResponsiveStyles('buttonSection')]"
        >
          <ButtonWrapper>
            <PerplexityBtn
              :href="perplexityUrl"
              target="_blank"
              rel="noopener noreferrer"
            >
              <img :src="perplexityIcon" alt="Perplexity Icon" /> Analyze with Perplexity
            </PerplexityBtn>
            <ChatGPTBtn
              :href="chatgptUrl"
              target="_blank"
              rel="noopener noreferrer"
            >
              <img :src="chatgptIcon" alt="ChatGPT Icon" /> Analyze with ChatGPT
            </ChatGPTBtn>
            <AudioCancelBtn @click="widgetStore.showEmailFormSection">Next</AudioCancelBtn>
          </ButtonWrapper>
        </div>
        
        <!-- Email form buttons in footer -->
        <div
          class="button-section"
          v-if="widgetStore.showEmailForm && !widgetStore.showThankYou"
          :style="[getResponsiveStyles('buttonSection')]"
        >
          <ButtonWrapper>
            <ChangeQuestionButton @click="handleEmailSubmit" :disabled="isSubmitting">
              <template v-if="isSubmitting">
                <Loader customClass="custom-loader-class" />
              </template>
              <template v-else> Sign up </template>
            </ChangeQuestionButton>
            <AudioCancelBtn @click="goToFirstStep" :disabled="isSubmitting"> Skip </AudioCancelBtn>
          </ButtonWrapper>
        </div>
        
        <div
          class="button-section"
          v-if="widgetStore.showThankYou"
          :style="[getResponsiveStyles('buttonSection')]"
        >
          <Button type="primary" class="action-button" @click="goToFirstStep"> Exit </Button>
        </div>

        <FooterText> Powered by My Speaking Score - Trusted TOEFL Speaking </FooterText>
      </div>
    </WidgetCard>
  </div>
</template>

<script setup>
import AudioRecorder from './common/AudioRecorder.vue'
import { ref, onMounted, computed, watch } from 'vue'
import { configData } from '@/json/card-config.js'
import { setBackoff, hasActiveBackoff, BACKOFF_KEYS } from '@/utils/backoff.js'
import { trackImpression } from '@/utils/tracking.js'
import defaultLogo from '../assets/images/logo.png'
import perplexityIcon from '../assets/images/perplexity.svg'
import chatgptIcon from '../assets/images/gpt.svg'
import { useWidgetStore } from '../stores/widgetStore.js'
import closeIcon from '../assets/images/X.svg'
import Loader from './common/Loader.vue'
import { useMutationBase } from '@/hooks/useMutationBase'
import { extractTextFromHTML, countWords } from '@/utils/extractTextfromHtml'
import { truncateToInteger } from '@/utils/truncateToInteger'
import TOEFLSpeakingAssessment from './common/TOEFLSpeakingAssessment.vue'
import { truncateToTwoDecimals } from '@/utils/truncateToDecimle'
import { useAxiosInstance } from '@/api/axiosInstance'
import { addSubscriberToGroup } from '@/services/mailerLite'
import { styled } from '@vue-styled-components/core'
import microphoneIcon from '@/assets/images/microphoneIcon.svg'

const axios = useAxiosInstance()

const widgetStore = useWidgetStore()
const logo = ref(defaultLogo)
const recordedDuration = ref('00:00')
const recordedBlob = ref(null) // store actual blob
const responseData = ref({})
const currentQuestion = ref('')
const isChangingQuestion = ref(false)
const isLoadingQuestion = ref(true)

// Store API response data
const apiResponseData = ref({})
const hasSecretKey = ref(false)
const isLogoLoading = ref(true)

// Add a ref to store the suffix fetched from the API
const analysisPromptSuffix = ref('')

// Function to fetch the suffix from the API
const fetchSuffix = async (scoreFormData) => {
  try {
    const response = await axios.post('/api/prompt', scoreFormData, {
      headers: {
        'x-api-secret': import.meta.env.VITE_API_SECRET_KEY,
        // Do NOT set 'Content-Type'; browser will set it for FormData
      },
    })
    analysisPromptSuffix.value = response.data?.data?.content || ''
  } catch (error) {
    console.error('Failed to fetch suffix:', error)
    analysisPromptSuffix.value = ''
  }
}

const showQuestions = () => {
  widgetStore.showQuestions()
}

const goToFirstStep = () => {
  widgetStore.hideEmailFormSection()
  widgetStore.setAssessmentResults(false)
  widgetStore.resetRecordingState()
  widgetStore.hideThankYouSection()
  widgetStore.cancel()
}

const skills = computed(() => {
  const results = widgetStore.elsaResults
  if (!results) return []
  return [
    {
      label: 'Task Score',
      value: ${truncateToTwoDecimals(results?.score)} /4,
      maxValue: 100,
      suffix: '%',
      percentage: (results?.score / 4) * 100,
      color: '#22C55E',
    },
    {
      label: 'Speed (wpm)',
      value: ${transcriptedText.value},
      maxValue: 100,
      suffix: '%',
      percentage: (transcriptedText.value / 200) * 100,
      color: '#3B82F6',
    },
    {
      label: 'Fluency',
      value: ${results?.elsa_results?.fluency} /100,
      maxValue: 100,
      suffix: '%',
      percentage: (results?.elsa_results?.fluency / 100) * 100,
      color: '#3B82F6',
    },
    {
      label: 'Pronunciation',
      value: ${results?.elsa_results?.pronunciation} /100,
      maxValue: 100,
      suffix: '%',
      percentage: (results?.elsa_results?.pronunciation / 100) * 100,
      color: '#3B82F6',
    },
    {
      label: 'Grammar',
      value: ${results?.elsa_results?.grammar}/100,
      maxValue: 100,
      suffix: '%',
      percentage: (results?.elsa_results?.grammar / 100) * 100,
      color: '#3B82F6',
    },
    {
      label: 'Vocabulary',
      value: ${results?.elsa_results?.vocabulary}/100,
      maxValue: 100,
      suffix: '%',
      percentage: (results?.elsa_results?.vocabulary / 100) * 100,
      color: '#3B82F6',
    },
  ]
})

const cancelRecording = () => {
  widgetStore.setRecordingActive(false)
  widgetStore.changeQuestion()
}

const formatDuration = (seconds) => {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return ${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}
}

const handleRecordingComplete = (params) => {
  widgetStore.setRecordingComplete(true, params.url)
  recordedDuration.value = formatDuration(params.duration)
  recordedBlob.value = params.url
}

const { mutateAsync: submitRecording } = useMutationBase({
  url: '/api/codebot/vox',
  headers: {
    'x-api-secret': import.meta.env.VITE_API_SECRET_KEY,
  },
  method: 'post',
  onSuccess: async (data) => {
    widgetStore.setAnalyzing(false)
    widgetStore.setAssessmentResults(true)

    widgetStore.setElsaResults(data)

    responseData.value = data
  },
  onError: (error) => {
    widgetStore.setAnalyzing(false)
    if (error.status_code == 400) {
      alert('There are some problems with your recording. Please try again.')
    } else {
      alert(error.message)
    }
  },
})
async function convertBlobUrlToFile(blobUrl, fileName) {
  const response = await fetch(blobUrl)

  const blob = await response.blob()

  const file = new File([blob], fileName, { type: blob.type })

  return file
}

const handleSubmit = async () => {
  if (!recordedBlob.value) {
    return
  }

  widgetStore.setAnalyzing(true)
  widgetStore.setAssessmentResults(false)
  try {
    const formData = new FormData()
    var fileOfBlob = await convertBlobUrlToFile(recordedBlob.value, 'filaName.wav')
    formData.append('file', fileOfBlob)

    await submitRecording(formData)
    // After scoring, prepare the FormData payload and fetch the suffix
    const results = widgetStore.elsaResults || {}
    const elsa = results.elsa_results || {}
    const scoreFormData = new FormData()
    scoreFormData.append('taskScore', truncateToTwoDecimals(results.score) || '-')
    scoreFormData.append('speed', transcriptedText.value || '-')
    scoreFormData.append('fluency', elsa.fluency || '-')
    scoreFormData.append('pronunciation', elsa.pronunciation || '-')
    scoreFormData.append('grammar', elsa.grammar || '-')
    scoreFormData.append('vocabulary', elsa.vocabulary || '-')
    scoreFormData.append('cefr', elsa.cefr_level || '-')
    scoreFormData.append('toefl', elsa.toefl_score || '-')
    scoreFormData.append('ielts', elsa.ielts_score || '-')
    scoreFormData.append('pte', elsa.pte_score || '-')
    await fetchSuffix(scoreFormData)
  } catch (error) {
    widgetStore.setAnalyzing(false)
  }
}

// fetch questions from api

const fetchQuestionsFromOpenAI = async () => {
  try {
    const prompt = 
                  You are a TOEFL Speaking test designer. Please create only one Task 1 independent speaking question for TOEFL practice.  
                  Randomly choose **one** of these three types and create a question accordingly:  
                  1) Agree/Disagree statement  
                  2) Choice between two options  
                  3) Hypothetical situation  
                  The question should be clear and suitable for non-native English speakers preparing for TOEFL.  
                  Do NOT provide multiple questions, only one question in your response.
                  The final question must be no more than 330 characters, including spaces.
                  

    // Use FormData for the new API
    const formData = new FormData()
    formData.append('model', 'gpt-4')
    formData.append('role', 'user')
    formData.append('prompt', prompt)
    formData.append('temperature', '0.7')

    const response = await axios.post('/api/openai', formData, {
      headers: {
        'x-api-secret': import.meta.env.VITE_API_SECRET_KEY,
      },
    })
    const content =
      response.data?.data?.choices?.[0]?.message?.content?.trim().replace(/^.*?:\s*/, '') ||
      response.data?.data?.content ||
      ''
    currentQuestion.value = content
    widgetStore.setCurrentGeneratedQuestion(content)

    return content
  } catch (err) {
    console.error('Failed to fetch OpenAI questions:', err)
    throw err
  } finally {
    isLoadingQuestion.value = false
  }
}

// change question

const handleChangeQuestion = async () => {
  if (isChangingQuestion.value) return // prevent multiple calls

  isChangingQuestion.value = true
  try {
    await fetchQuestionsFromOpenAI()
    widgetStore.changeQuestion()
  } catch (error) {
    console.error('Change question failed:', error)
  } finally {
    isChangingQuestion.value = false
  }
}

const retryRecording = () => {
  widgetStore.resetRecordingState()
}

const recordingComplete = computed(() => widgetStore.recordingComplete)
const recordedAudioUrl = computed(() => widgetStore.recordedAudioUrl)
const recordingActive = computed(() => widgetStore.recordingActive)
const questionSelected = computed(() => widgetStore.questionSelected)

const transcriptHTML = computed(() => widgetStore.elsaResults?.transcript || '')
const plainTextTranscript = computed(() => extractTextFromHTML(transcriptHTML.value))
const transcriptWordCount = computed(() => countWords(plainTextTranscript.value))

// const transcriptedText = truncateToInteger((transcriptWordCount.value / 60) * 45)
const transcriptedText = computed(() => {
  return truncateToInteger((transcriptWordCount.value / 60) * 45)
})

const handleSelectQuestion = () => {
  const selected = widgetStore.currentGeneratedQuestion || ''
  if (selected) {
    widgetStore.selectQuestion(selected)
  } else {
    console.warn('Selected question is not valid')
  }
}

const handleCancel = () => {
  widgetStore.cancel()
}

// const changeQuestion = () => {
//   widgetStore.changeQuestion()
// }

const props = defineProps({
  userConfig: {
    type: Object,
    default: () => ({}),
  },
})

const config = computed(() => {
  return {
    ...configData,
    ...props.userConfig,
    styles: generateDynamicStyles({
      ...configData,
      ...props.userConfig,
    }),
  }
})
const currentBreakpoint = ref('desktop')
const userInteracted = ref(false)
const widgetClosed = ref(false)
const isVisible = ref(true)

// New function to get widget container styles including position
const getWidgetContainerStyles = () => {
  if (!config.value || !config.value.styles) return {}

  const baseWidgetStyles = config.value.styles.widgetContainer || {}
  const position = config.value?.position || 'right-bottom'
  const positionStyles = config.value.styles.positionStyles?.[position] || {}

  // Mobile specific positioning adjustments
  const isMobile = currentBreakpoint.value === 'mobile'
  let mobileOverrides = {}
  
  if (isMobile) {
    if (position === 'center') {
      mobileOverrides = {
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        padding: '10px',
      }
    } else if (position === 'right-bottom') {
      mobileOverrides = {
        bottom: '10px',
        right: '10px',
        left: '10px',
        width: 'auto',
      }
    } else if (position === 'bottom') {
      mobileOverrides = {
        bottom: '0',
        left: '0',
        right: '0',
        padding: '10px',
      }
    }
  }

  return {
    ...baseWidgetStyles,
    ...positionStyles,
    ...mobileOverrides,
  }
}

// Function to generate dynamic styles based on JSON config
const generateDynamicStyles = (mergedConfig) => {
  const pos = mergedConfig.position || 'right-bottom'
  const styles = { ...mergedConfig.styles }

  styles.card = {
    ...styles.card,
    width: '450px !important',
    height: '650px',
    display: pos === 'bottom' ? 'flex' : 'block',
    gap: pos === 'bottom' ? '15px' : '',
    alignItems: pos === 'bottom' ? 'center' : '',
  }

  // Better mobile responsive handling
  if (!styles.responsive) styles.responsive = {}
  if (!styles.responsive.mobile) styles.responsive.mobile = {}
  if (!styles.responsive.tablet) styles.responsive.tablet = {}

  // Mobile specific overrides
  styles.responsive.mobile.card = {
    ...styles.responsive.mobile.card,
    width: 'calc(100vw - 32px) !important',
    maxWidth: '400px !important',
    height: 'auto !important',
    minHeight: '500px !important',
  }

  // Tablet specific overrides
  styles.responsive.tablet.card = {
    ...styles.responsive.tablet.card,
    width: '420px !important',
    height: '600px !important',
  }

  return styles
}

// Get responsive styles based on current breakpoint
const getResponsiveStyles = (element) => {
  if (!config.value || !config.value.styles) return {}

  const baseStyles = config.value.styles[element] || {}
  const responsiveStyles =
    config.value.styles.responsive?.[currentBreakpoint.value]?.[element] || {}

  return { ...baseStyles, ...responsiveStyles }
}

// Set up responsive breakpoints
const detectBreakpoint = () => {
  const width = window.innerWidth
  if (width < 768) {
    currentBreakpoint.value = 'mobile'
  } else if (width >= 768 && width < 1024) {
    currentBreakpoint.value = 'tablet'
  } else {
    currentBreakpoint.value = 'desktop'
  }
}

// Function to simulate user interaction (e.g. form focus)
const markUserInteracted = () => {
  if (!userInteracted.value) {
    setBackoff(BACKOFF_KEYS.PASSIVE, 7)
    userInteracted.value = true
  }
}

// Explicit close handler
const handleClose = () => {
  // setBackoff(BACKOFF_KEYS.CLOSED, 30)
  widgetClosed.value = true
  isVisible.value = false
}

const beforeUnmount = () => {
  window.removeEventListener('resize', detectBreakpoint)
}

// Visibility logic
const computeVisibility = () => {
  if (hasActiveBackoff()) return false
  if (!config.value?.visibleOnDevices) return true
  return !config.value.visibleOnDevices.includes(currentBreakpoint.value)
}

onMounted(async () => {
  const secretKey = config.value?.secretKey || ''
  
  // If no secret key, use default logo immediately without loading
  if (!secretKey) {
    logo.value = defaultLogo
    isLogoLoading.value = false
    apiResponseData.value = {}
    hasSecretKey.value = false
    return
  }
  
  // If secret key exists, try to fetch from API
  try {
    const formData = new FormData()
    formData.append('secretKey', secretKey)
    const response = await axios.post('/api/details', formData, {
      headers: {
        'x-api-secret': import.meta.env.VITE_API_SECRET_KEY,
      },
    })
    
    // Store the API response data
    apiResponseData.value = response.data?.data || {}
    hasSecretKey.value = true
    
    // Set the logo and branding
    if (response.data?.data?.logo) {
      logo.value = response.data.data.logo
    } else {
      logo.value = defaultLogo
    }
  } catch (err) {
    console.error('Failed to fetch brand data:', err)
    logo.value = defaultLogo
    apiResponseData.value = {}
    hasSecretKey.value = false
  } finally {
    isLogoLoading.value = false
  }
})

onMounted(() => {
  detectBreakpoint()
  window.addEventListener('resize', detectBreakpoint)

  const delay = config.value?.delayInSeconds || 0

  if (delay > 0) {
    isVisible.value = false
    setTimeout(() => {
      if (!widgetClosed.value && computeVisibility()) {
        isVisible.value = true
        trackImpression()
      }
    }, delay * 1000)
  } else {
    isVisible.value = computeVisibility()
    if (isVisible.value) {
      trackImpression()
    }
  }
  fetchQuestionsFromOpenAI()
})

// To add the fonts in the widget
onMounted(() => {
  const style = document.createElement('style')
  style.innerText = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

    .widget-container * {
      font-family: 'Inter', sans-serif !important;
    }
  `
  document.head.appendChild(style)
})

// optional code for report
// window.addEventListener('beforeunload', () => {
//   sendTrackingDataToAPI()
// })

const emailForm = ref({
  email: '',
  name: '',
  consent: false,
})
const isSubmitting = ref(false)

const emailInputStyles = {
  width: '100%',
  height: '52px',
  borderRadius: '60px',
  padding: '14px 16px',
  border: '1px solid #eaeaea',
  outline: 'none',
  boxSizing: 'border-box'
}

const handleEmailSubmit = async () => {
  if (!emailForm.value.email || !emailForm.value.name) {
    alert('Please fill in both email and name fields')
    return
  }

  try {
    isSubmitting.value = true
    const secretKey = config.value?.secretKey || ''
    await addSubscriberToGroup(emailForm.value.email, emailForm.value.name, emailForm.value.consent)
    // Send data to MSS
    try {
      await axios.post(/api/capture-visitor, {
        email: emailForm.value.email,
        name: emailForm.value.name,
        consent: emailForm.value.consent,
        domain: window.location.origin,
        secretKey: secretKey,
      })
      
      // if secret key is present, send data to the domain api
      if(hasSecretKey && apiResponseData.value?.api_capture_visitor) {
        await axios.post(apiResponseData.value?.api_capture_visitor, {
          email: emailForm.value.email,
          name: emailForm.value.name,
          consent: emailForm.value.consent
        })
      }

    } catch (error) {
      console.error('Error sending data to MSS:', error)
    }
    // Reset form fields after successful submission
    emailForm.value = {
      email: '',
      name: '',
      consent: false,
    }
    widgetStore.showThankYouSection()
  } catch (error) {
    console.error('Error submitting email:', error)
  } finally {
    isSubmitting.value = false
  }
}

// Dynamic analysis URLs for ChatGPT and Perplexity
const chatgptUrl = computed(() => {
  const query = analysisPromptSuffix.value || ''
  return https://chat.openai.com/?q=${encodeURIComponent(query)}
})
const perplexityUrl = computed(() => {
  const query = analysisPromptSuffix.value || ''
  return https://www.perplexity.ai/search?q=${encodeURIComponent(query)}
})

// styled component for css app

const StyledHeading = styled('h2')`
  font-family: 'Inter', sans-serif;
  font-weight: 700;
  font-size: 26px;
  line-height: 1.2;
  letter-spacing: -0.5px;
  text-align: center;
  color: #1a1a1a;
  margin-bottom: 16px;

  @media (max-width: 767px) {
    font-size: 20px;
    margin-bottom: 12px;
    padding: 0 10px;
  }

  @media (min-width: 768px) and (max-width: 1023px) {
    font-size: 24px;
    margin-bottom: 14px;
  }
`

const StyledText = styled('p')`
  font-family: 'Inter', sans-serif;
  font-weight: 400;
  font-size: 18px;
  line-height: 1.4;
  letter-spacing: 0.2px;
  text-align: center;
  color: #424242;
  margin: 0;

  @media (max-width: 767px) {
    font-size: 16px;
    line-height: 1.5;
    padding: 0 10px;
  }

  @media (min-width: 768px) and (max-width: 1023px) {
    font-size: 17px;
  }
`

const WidgetCard = styled('div')`
  width: 450px;
  height: 650px;
  border-radius: 40px;
  padding: 15px;
  box-shadow: rgba(0, 0, 0, 0.1) 0px 4px 8px;
  margin: 16px;
  background: radial-gradient(
    58.44% 96.6% at 50% 50%,
    rgb(255, 230, 252) 36%,
    rgb(255, 255, 255) 98%
  );

  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: center;

  /* Mobile responsive styles */
  @media (max-width: 767px) {
    width: calc(100vw - 20px);
    max-width: 400px;
    height: 650px;
    min-height: 500px;
    margin: 10px auto;
    padding: 15px 8px;
    border-radius: 20px;
  }

  /* Tablet responsive styles */
  @media (min-width: 768px) and (max-width: 1023px) {
    width: 420px;
    height: 650px;
    margin: 16px;
  }
`

const MicrophoneIcon = styled('div')
  width: 60px;
  height: 60px;
  background-color: #3b82f6;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;


const Button = styled('button')
  width: 100%;
  height: 52px;
  gap: 10px;
  border-radius: 60px;
  padding: 14px 28px;
  background-color: #1871e9;
  cursor: pointer;
  border: none;
  font-family: 'Inter', sans-serif !important;
  outline: none;
  font-weight: 500;
  font-size: 16px;
  line-height: 100%;
  letter-spacing: 0%;
  color: #f9f9f9;
  &:hover {
    background-color: #ace798 !important;
    color: #000 !important;
    box-shadow:
      0 6px 18px #1871e91f,
      0 1.5px 4px #00000014;
    transition:
      background-color 0.2s cubic-bezier(0.4, 0, 0.2, 1),
      color 0.2s cubic-bezier(0.4, 0, 0.2, 1),
      box-shadow 0.2s cubic-bezier(0.4, 0, 0.2, 1),
      transform 0.15s cubic-bezier(0.4, 0, 0.2, 1);
  }


const FooterText = styled('p')
  font-size: 12px;
  color: rgb(156, 163, 175);
  margin: 2px;
  font-family: 'Inter', sans-serif;
  text-align: center;

const QuestionWrapper = styled('div')
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 40px;
  justify-content: center;
  align-items: center;


const Question = styled('h2')
  font-weight: 600;
  font-size: 16px;
  padding: 16px;
  line-height: 24px;
  letter-spacing: 0%;
  color: #424242;
  margin: 0 auto;
  font-family: 'Inter', sans-serif;


const QuestionPara = styled('p')`
  font-weight: 600;
  font-size: 16px;
  line-height: 1.5;
  letter-spacing: 0%;
  color: #424242;
  margin: 0 auto 24px;
  font-family: 'Inter', sans-serif !important;
  max-width: 400px;
  max-height: 247px;
  overflow-y: auto;
  padding: 10px;
  border-radius: 8px;
  background: rgba(248, 250, 252, 0.5);
  scrollbar-width: thin;
  scrollbar-color: #cbd5e1 #f1f5f9;

  @media (max-width: 767px) {
    max-width: 100%;
    font-size: 14px;
    padding: 12px;
    max-height: 200px;
    margin: 0 auto 16px;
  }

  @media (min-width: 768px) and (max-width: 1023px) {
    max-width: 350px;
    font-size: 15px;
  }
  
  &::-webkit-scrollbar {
    width: 6px;
  }
  
  &::-webkit-scrollbar-track {
    background: #f1f5f9;
    border-radius: 3px;
  }
  
  &::-webkit-scrollbar-thumb {
    background: #cbd5e1;
    border-radius: 3px;
  }
  
  &::-webkit-scrollbar-thumb:hover {
    background: #94a3b8;
  }
`

const AnswerQuestionButton = styled('button')
  height: 52px;
  gap: 10px;
  border-radius: 60px;
  padding: 14px 28px !important;
  cursor: pointer;
  border: none;
  outline: none;
  font-family: 'Inter', sans-serif !important;
  font-weight: 500;
  font-size: 16px;
  letter-spacing: 0%;
  color: #f9f9f9;
  background-color: #1871e9;
  &:hover {
    background-color: #ace798 !important;
    color: #000 !important;
    box-shadow:
      0 6px 18px #1871e91f,
      0 1.5px 4px #00000014;
    transition:
      background-color 0.2s cubic-bezier(0.4, 0, 0.2, 1),
      color 0.2s cubic-bezier(0.4, 0, 0.2, 1),
      box-shadow 0.2s cubic-bezier(0.4, 0, 0.2, 1),
      transform 0.15s cubic-bezier(0.4, 0, 0.2, 1);
  }


const AudioCancelBtn = styled('button')`
  width: 100%;
  height: 52px;
  background-color: transparent;
  color: #007aff;
  border: 1px solid #007aff;
  padding: 12px 24px;
  border-radius: 60px;
  font-size: 16px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  font-family: 'Inter', sans-serif !important;

  @media (max-width: 767px) {
    height: 48px;
    font-size: 14px;
    padding: 10px 20px;
    border-radius: 50px;
  }

  @media (min-width: 768px) and (max-width: 1023px) {
    height: 50px;
    font-size: 15px;
  }

  &:hover {
    background-color: #ace798 !important;
    color: #000 !important;
    border-color: transparent !important;
    transition:
      background-color 0.2s cubic-bezier(0.4, 0, 0.2, 1),
      color 0.2s cubic-bezier(0.4, 0, 0.2, 1),
      box-shadow 0.2s cubic-bezier(0.4, 0, 0.2, 1),
      transform 0.15s cubic-bezier(0.4, 0, 0.2, 1);
  }
`

const ButtonWrapper = styled('div')`
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 420px;

  @media (max-width: 767px) {
    width: 100%;
    max-width: 350px;
  }

  @media (min-width: 768px) and (max-width: 1023px) {
    width: 380px;
  }
`

const CloseBtn = styled('button')`
  color: black !important;
  position: absolute;
  top: 36px;
  right: 36px;
  background: none;
  font-size: 16px;
  cursor: pointer;
  z-index: 1000;
  border: none;

  @media (max-width: 767px) {
    top: 40px;
    right: 30px;
    font-size: 14px;
    width: 20px;
    height: 20px;
  }

  @media (min-width: 768px) and (max-width: 1023px) {
    top: 30px;
    right: 30px;
  }
`

const Label = styled('p')
  font-family: Poppins;
  font-weight: 700;
  font-size: 18px;
  line-height: 100%;
  letter-spacing: 0%;
  text-align: center;
  color: #1a1a1a;

const ChangeQuestionButton = styled('button')`
  width: 420px !important;
  height: 52px;
  gap: 10px;
  border-radius: 60px;
  padding: 14px 28px !important;
  cursor: pointer;
  border: none;
  outline: none;
  font-family: 'Inter', sans-serif;
  font-weight: 500;
  font-size: 16px;
  letter-spacing: 0%;
  color: #f9f9f9;
  background-color: #1871e9;
  
  @media (max-width: 767px) {
    width: 100% !important;
    height: 48px;
    font-size: 14px;
    padding: 12px 20px !important;
    border-radius: 50px;
  }

  @media (min-width: 768px) and (max-width: 1023px) {
    width: 380px !important;
    height: 50px;
    font-size: 15px;
  }

  &:hover {
    background-color: #ace798 !important;
    color: #000 !important;
    border-color: transparent !important;
    transition:
      background-color 0.2s cubic-bezier(0.4, 0, 0.2, 1),
      color 0.2s cubic-bezier(0.4, 0, 0.2, 1),
      box-shadow 0.2s cubic-bezier(0.4, 0, 0.2, 1),
      transform 0.15s cubic-bezier(0.4, 0, 0.2, 1);
  }
`

const SignupLinkButton = styled('a')`
  width: 420px !important;
  height: 52px;
  gap: 10px;
  border-radius: 60px;
  padding: 14px 28px !important;
  cursor: pointer;
  border: none;
  outline: none;
  font-family: 'Inter', sans-serif;
  font-weight: 500;
  font-size: 16px;
  letter-spacing: 0%;
  color: #f9f9f9;
  background-color: #1871e9;
  text-decoration: none;
  display: flex;
  align-items: center;
  justify-content: center;

  @media (max-width: 767px) {
    width: 100% !important;
    height: 48px;
    font-size: 14px;
    padding: 12px 20px !important;
    border-radius: 50px;
  }

  @media (min-width: 768px) and (max-width: 1023px) {
    width: 380px !important;
    height: 50px;
    font-size: 15px;
  }

  &:hover {
    background-color: #ace798 !important;
    color: #000 !important;
    border-color: transparent !important;
    transition:
      background-color 0.2s cubic-bezier(0.4, 0, 0.2, 1),
      color 0.2s cubic-bezier(0.4, 0, 0.2, 1),
      box-shadow 0.2s cubic-bezier(0.4, 0, 0.2, 1),
      transform 0.15s cubic-bezier(0.4, 0, 0.2, 1);
  }
`

const ContentWrapper = styled('div')
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;


const MicrophoneContainer = styled('div')
  margin: 12px 0 0 0;
  display: flex;
  align-items: center;
  justify-content: center;
  img {
    width: 36px;
    height: 36px;
  }

const CancelBtnLoader = styled('div')
  width: 24px;
  height: 24px;
  border: 5px solid #1871e9;
  border-bottom-color: transparent;
  border-radius: 50%;
  display: inline-block;
  box-sizing: border-box;
  animation: rotation 1s linear infinite;


const RecordingCompleteBlock = styled('div')
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 24px;
  padding: 20px;
  font-family: 'Inter', sans-serif !important;

const RecordingCompleteLabel = styled('label')
  font-weight: 700;
  font-size: 18px;
  line-height: 100%;
  letter-spacing: 0%;
  text-align: center;
  color: #1a1a1a;
  margin: 0;


const Timer = styled('div')
  font-weight: 500;
  font-size: 28px;
  line-height: 100%;
  letter-spacing: 0%;
  text-align: center;
  color: #1a1a1a;

const RecordedDuration = styled('div')
  font-weight: 500;
  font-size: 38px;
  line-height: 100%;
  letter-spacing: 0%;
  text-align: center;
  color: #1a1a1a;

const SecondRemaining = styled('p')
  font-weight: 400;
  font-size: 12px;
  line-height: 100%;
  letter-spacing: 0%;
  text-align: center;
  color: #424242;
  margin: 0px;


const RecordingActionButtons = styled('div')
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 16px;

const RecordedAudioPlayer = styled('audio')
  width: 100%;


const LoadingState = styled('div')`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  justify-content: center;

  p:first-of-type {
    font-weight: 500;
    font-size: 28px;
    line-height: 100%;
    letter-spacing: 0%;
    text-align: center;
    color: #1a1a1a;
    margin: 0px;
    font-family: 'Inter', sans-serif !important;
  }
  p:last-of-type {
    font-weight: 400;
    font-size: 14px;
    line-height: 100%;
    letter-spacing: 0%;
    text-align: center;
    color: #424242;
    margin: 0px;
    font-family: 'Inter', sans-serif !important;
  }
`

const PerplexityBtn = styled('a')
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  height: 52px;
  box-sizing: border-box;
  background-color: #1f1f1f;
  color: #f9f9f9 !important;
  border: 1px solid #1f1f1f;
  text-decoration: none;
  padding: 12px 24px;
  border-radius: 60px;
  font-size: 16px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  font-family: 'Inter', sans-serif !important;
  &:hover {
    filter: brightness(1.15);
  }

const ChatGPTBtn = styled('a')`
    display: flex;
    align-items: center;
    justify-content: center;
    text-decoration: none;
    gap: 10px;
    width: 100%;
    height: 52px;
     box-sizing: border-box;
    background-color: #1cab83;
    color: #f9f9f9 !important;
    border: 1px solid #1CAB83;
    padding: 12px 24px;
    border-radius: 60px;
    font-size: 16px;
    font-weight: 500;
    cursor: pointer;
    font-family: 'Inter', sans-serif !important;

    transition: all .2s;
      &:hover {
      filter: brightness(1.15);
    }
}
`

const EmailFormState = styled('div')
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 25px;
  padding: 20px;


const EmailFormHeader = styled('div')
  display: flex;
  flex-direction: column;
  gap: 16px;
  text-align: center;
  h2{
      font-weight: 500;
      font-size: 28px;
      line-height: 1.2;
      letter-spacing: -0.5px;
      text-align: center;
      color: #1a1a1a;
      font-family: 'Inter', sans-serif !important;
      margin: 0;
  }
}


const EmailInputContainer = styled('div')
  max-width: 400px;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;


const LabelInput = styled('label')
  font-weight: 400;
  font-size: 14px;
  line-height: 100%;
  letter-spacing: 0%;
  color: #424242;
  margin-left: 6px;
  font-family: 'Inter', sans-serif !important;


const ThankYouState = styled('div')`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;

  h2 {
    font-weight: 700;
    font-size: 28px;
    line-height: 100%;
    letter-spacing: 0%;
    text-align: center;
    color: #1a1a1a;
    font-family: 'Inter', sans-serif !important;
    margin: 0px;
  }
  p {
    font-family: 'Inter', sans-serif !important;
    margin: 0px;
    font-weight: 400;
    font-size: 18px;
    line-height: 100%;
    letter-spacing: 0%;
    text-align: center;
    color: #424242;
  }
`

const ThankYouIcon = styled('div')
  width: 64px;
  height: 64px;


const SelectedQuestionDisplay = styled('div')
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 24px;
  padding: 20px;
  
  h2 {
    font-family: 'Inter', sans-serif !important;
    font-weight: 600;
    font-size: 16px;
    line-height: 24px;
    letter-spacing: 0%;
    text-align: center;
    color: #000000;
  }
  p {
    font-family: 'Inter', sans-serif !important;
    font-weight: 600;
    font-size: 16px;
    line-height: 24px;
    letter-spacing: 0%;
    color: #424242;
    max-width: 386px;
    margin: 0 auto;
    
  }

</script>

<style>
@import '@/assets/css/widget.css';

@keyframes rotation {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}
.cancel-btn-loader {
  width: 24px;
  height: 24px;
  border: 5px solid #1871e9;
  border-bottom-color: transparent;
  border-radius: 50%;
  display: inline-block;
  box-sizing: border-box;
  animation: rotation 1s linear infinite;
}

.logo-loader {
  width: 20px;
  height: 20px;
  border: 3px solid #1871e9;
  border-bottom-color: transparent;
  border-radius: 50%;
  display: inline-block;
  box-sizing: border-box;
  animation: rotation 1s linear infinite;
}

@keyframes rotation {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}
</style>