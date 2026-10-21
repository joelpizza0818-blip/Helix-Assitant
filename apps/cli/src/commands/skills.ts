import prompts from 'prompts';
import chalk from 'chalk';
import type { AgentClient } from '../client/agent-client';
import { formatSkill, ORANGE_BOLD, GREEN, RED, YELLOW, GRAY, BOLD, DIM } from '../ui/colors';

export async function handleListSkills(client: AgentClient, specificSkill?: string): Promise<void> {
  try {
    const skills = await client.getSkills();
    if (!skills || skills.length === 0) {
      console.log(GRAY('\n  No hay skills registradas en el agente.\n'));
      return;
    }

    if (specificSkill) {
      const match = skills.find(
        (s) => s.name.toLowerCase() === specificSkill.toLowerCase() || `@${s.name.toLowerCase()}` === specificSkill.toLowerCase()
      );
      if (match) {
        console.log(`\n${BOLD('Detalles de la Skill:')}`);
        console.log(`  Nombre:       ${formatSkill(match.name)}`);
        console.log(`  Descripción:  ${chalk.white(match.description || 'Sin descripción')}`);
        if (match.triggers && match.triggers.length > 0) {
          console.log(`  Disparadores: ${DIM(match.triggers.join(', '))}`);
        }
        if (match.instructions) {
          console.log(`  Instrucciones:\n${GRAY('    ' + match.instructions.replace(/\n/g, '\n    '))}`);
        }
        console.log('');
        return;
      }
      console.log(YELLOW(`\n  Skill "${specificSkill}" no encontrada. Listando todas las disponibles:\n`));
    }

    console.log(`\n${BOLD('⚡ Skills Registradas en HELIX:')}\n`);
    for (const skill of skills) {
      const nameTag = formatSkill(skill.name);
      const isCustom = skill.custom ? chalk.hex('#FFA500')(' [custom]') : '';
      console.log(`  ${ORANGE_BOLD('✦')} ${nameTag}${isCustom}`);
      if (skill.description) {
        console.log(`    ${DIM(skill.description)}`);
      }
      if (skill.triggers && skill.triggers.length > 0) {
        console.log(`    ${GRAY('Triggers:')} ${DIM(skill.triggers.slice(0, 4).join(', '))}`);
      }
      console.log('');
    }
  } catch (err) {
    console.log(RED(`  Error al obtener skills: ${(err as Error).message}\n`));
  }
}

export async function handleCreateSkill(client: AgentClient): Promise<void> {
  console.log(`\n${BOLD('🛠️  Crear Nueva Skill en HELIX')}\n`);

  const answers = await prompts([
    {
      type: 'text',
      name: 'name',
      message: 'Nombre de la skill (ej. web-summarizer, code-auditor):',
      validate: (v: string) =>
        /^[a-zA-Z0-9_-]+$/.test(v)
          ? true
          : 'El nombre solo puede contener letras, números, guiones y guiones bajos',
    },
    {
      type: 'text',
      name: 'description',
      message: 'Descripción corta de la funcionalidad:',
      validate: (v: string) => (v && v.trim() ? true : 'La descripción es requerida'),
    },
    {
      type: 'text',
      name: 'triggers',
      message: 'Palabras clave disparadoras (separadas por coma, opcional):',
      initial: '',
    },
    {
      type: 'text',
      name: 'instructions',
      message: 'Instrucciones o system prompt para la ejecución de la skill:',
      validate: (v: string) => (v && v.trim() ? true : 'Las instrucciones son requeridas'),
    },
  ]);

  if (!answers.name || !answers.description || !answers.instructions) {
    console.log(YELLOW('\nOperación cancelada.\n'));
    return;
  }

  const triggersList = typeof answers.triggers === 'string'
    ? answers.triggers.split(',').map((t: string) => t.trim()).filter(Boolean)
    : [];

  const skillPayload = {
    name: answers.name.trim(),
    description: answers.description.trim(),
    triggers: triggersList,
    instructions: answers.instructions.trim(),
  };

  try {
    console.log(GRAY(`\nGuardando skill ${formatSkill(skillPayload.name)}...`));
    await client.saveSkill(skillPayload);
    console.log(GREEN(`✔ ¡Skill ${formatSkill(skillPayload.name)} creada con éxito!`));
    console.log(DIM(`  Puedes invocarla usando: ${formatSkill(skillPayload.name)} <tu consulta>\n`));
  } catch (err) {
    console.log(RED(`✖ Error al crear la skill: ${(err as Error).message}\n`));
  }
}
