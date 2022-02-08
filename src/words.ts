const defaultMessage = ' Using word of the day instead.'

export function getWordOfTheDay() {
  if (location.search) {
    try {
      const query = atob(location.search.slice(1))
      if (query.length !== 6) {
        alert(`Incorrect word length from encoded query. ${defaultMessage}`)
      } else {
        return query
      }
    } catch (e) {
      alert(`Malformed encoded word query. ${defaultMessage}`)
    }
  }

  const now = new Date()
  const start = new Date(2022, 0, 0)
  const diff = Number(now) - Number(start)
  let day = Math.floor(diff / (1000 * 60 * 60 * 24))
  while (day > answers.length) {
    day -= answers.length
  }
  return answers[day]
}

// copied from Wordle source
const answers = [
	'0+22+1',
	'0+23*1',
	'0+23/1',
	'0+24-1',
	'1+21+1',
	'1+22*1',
	'1+22/1',
	'1*22+1',
	'1+23-1',
	'1*23*1',
	'1*23/1',
	'1*24-1',
	'1+11*2',
	'1+20+2',
	'1*21+2',
	'1+24-2',
	'1*25-2',
	'1+44/2',
	'1*46/2',
	'1+11*2',
	'1+20+2',
	'1*21+2',
	'1+24-2',
	'1*25-2',
	'1+44/2',
	'1*46/2',
	'2+19+2',
	'2+23-2',
	'2*23/2',
	'2+42/2',
	'2+43/2',
	'2*13-3',
	'2+18+3',
	'2+24-3',
	'2*35/3',
	'2+63/3',
	'2+64/3',
	'3+23-3',
	'3*23/3',
	'3+60/3',
	'3+17+3',
	'3+16+4',
	'3+24-4',
	'3*31/4',
	'3+80/4',
	'4+14+5',
	'4+24-5',
	'4+95/5',
	'5+13+5',
	'5+23-5',
	'5+90/5',
	'5+12+6',
	'5+24-6',
	'6+11+6',
	'6+23-6',
	'6+24-7',
	'7+23-7',
	'8+23-8',
	'8+24-9',
]

const allowedGuesses = [
  '52/4+7'
]

export const allWords = [...answers, ...allowedGuesses]
